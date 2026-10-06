import { alignGlobal, normalizedDistance } from "./alignment.js";
import type { Tracker } from "./tracker.js";
import type { WordState, WordVerdict } from "./types.js";
import { pausalPhonemes } from "./waqf.js";

interface Span {
  /** Heard index range [from, to) assigned to the word. */
  from: number;
  to: number;
  /** Index of the run (monotonic stretch of the trail) that produced it. */
  run: number;
}

interface Segment {
  heardFrom: number;
  heardTo: number;
  /** Extra heard chars of context before `heardFrom` (never before the previous segment). */
  contextFrom: number;
  refFrom: number;
  refTo: number;
  run: number;
}

/**
 * Traces the tracker's trail back into per-word verdicts.
 *
 * The trail is split into monotonic runs (a new run starts wherever the
 * cursor cell moved backwards — a repeat or a jump back). Each run's heard
 * chars are aligned globally onto the reference stretch it covered, which
 * assigns every heard char to a word. A word is then judged on the chars
 * assigned to it: too few → skipped (only when it lies between matched
 * words), else by graded distance and decoder margin. Words near the end of
 * the heard stream, the cursor word, and words at/after the cursor from an
 * earlier run stay `pending`.
 *
 * Long runs are cut into segments so that only the last ~300 heard chars
 * are re-aligned per call; closed segments are cached.
 */
export class VerdictTracer {
  private readonly tracker: Tracker;
  private cache = new Map<string, Map<number, Span>>();
  /** Local word → its encoded pausal form (null: stopping changes nothing). */
  private readonly pausalCache = new Map<number, Uint8Array | null>();
  private cachedRevision = 0;
  static readonly SEGMENT_CHARS = 300;
  static readonly CONTEXT_CHARS = 6;

  constructor(tracker: Tracker) {
    this.tracker = tracker;
    this.cachedRevision = tracker.revision;
  }

  private segments(): Segment[] {
    const { trail } = this.tracker;
    const n = trail.length;
    const segs: Segment[] = [];
    if (n === 0) return segs;
    let run = 0;
    let runStart = 0;
    let segStart = 0;
    let prevSegStart = 0;
    const close = (end: number, r: number) => {
      const firstCell = trail[segStart];
      const refFrom = this.wordStartOfCell(firstCell);
      const refTo = trail[end - 1];
      segs.push({
        heardFrom: segStart,
        heardTo: end,
        contextFrom: segStart === runStart && r === 0 ? segStart : Math.max(prevSegStart, segStart - VerdictTracer.CONTEXT_CHARS),
        refFrom,
        refTo,
        run: r,
      });
      prevSegStart = segStart;
      segStart = end;
    };
    for (let g = 1; g < n; g++) {
      if (trail[g] < trail[g - 1]) {
        close(g, run);
        run++;
        runStart = g;
      } else if (g - segStart >= VerdictTracer.SEGMENT_CHARS) {
        close(g, run);
      }
    }
    close(n, run);
    return segs;
  }

  /** The word's pausal form as cost-table ids, derived once — see waqf.ts. */
  private pausalOf(w: number): Uint8Array | null {
    const hit = this.pausalCache.get(w);
    if (hit !== undefined) return hit;
    const t = this.tracker;
    const g = t.firstWord + w;
    const ref = t.corpus.ref(g);
    const atAyahEnd = ref.word === t.corpus.ayahWordCount(ref.surah, ref.ayah) - 1;
    const p = pausalPhonemes(t.corpus.phonemes(g), t.corpus.plainWord(g), atAyahEnd);
    const enc = p === null ? null : t.table.encode(p);
    this.pausalCache.set(w, enc);
    return enc;
  }

  /**
   * Where the reciter's silence begins, if this word's chars run into a real
   * pause — or -1 when they ran straight on. A stop is only a stop with
   * silence behind it: the same pausal sound mid-flow stays judged against the
   * flowing form. The bar is `settleFrames` — one second, the same silence
   * that settles a verdict.
   *
   * The boundary is found by walking the heard stream, not by trusting
   * `span.to`, because the span was carved by aligning against the FLOWING
   * form and both of its edges lie. Measured on the نَارًا recording: the
   * stop's long alif has no home in the flowing form, so the alignment first
   * pushed those chars onto ذَاتَ's leading ذَا — and once the reciter
   * REPEATED the phrase, the repeat's own سَيَ was glued onto the stopped
   * word's span, putting the silence in the span's middle. So: the word's
   * utterance is everything from its first char up to the FIRST silence, and
   * whatever the alignment attached beyond that silence belongs to a
   * different utterance. A silence further than a few chars past the flowing
   * span's end means the reciter simply kept going.
   */
  private stopBoundary(span: Span): number {
    const t = this.tracker;
    const heard = t.heard;
    const limit = Math.min(heard.length, span.to + 4);
    for (let i = span.from + 1; i <= limit; i++) {
      if (i === heard.length) return i; // stream end: the silence now settling it
      if (heard[i].frame - heard[i - 1].frame >= t.cfg.settleFrames) return i;
    }
    return -1;
  }

  /** Reference start of the word containing the char just before `cell`. */
  private wordStartOfCell(cell: number): number {
    if (cell <= 0) return 0;
    const w = this.tracker.wordOfPos[Math.min(cell, this.tracker.length) - 1];
    return this.tracker.localWordStart[w];
  }

  private spansOf(seg: Segment, open: boolean): Map<number, Span> {
    const key = `${seg.contextFrom}:${seg.heardTo}:${seg.refFrom}:${seg.refTo}`;
    if (!open) {
      const hit = this.cache.get(key);
      if (hit) return hit;
    }
    const out = new Map<number, Span>();
    if (seg.refTo > seg.refFrom) {
      const heard = Uint8Array.from(this.tracker.heardIds.slice(seg.contextFrom, seg.heardTo));
      const assign = alignGlobal(heard, this.tracker.ref, seg.refFrom, seg.refTo, this.tracker.table);
      for (let i = 0; i < assign.length; i++) {
        if (assign[i] < 0) continue;
        const w = this.tracker.wordOfPos[assign[i]];
        const idx = seg.contextFrom + i;
        const s = out.get(w);
        if (s) s.to = idx + 1;
        else out.set(w, { from: idx, to: idx + 1, run: seg.run });
      }
    }
    // No entry cap. `verdicts` walks every closed segment on every call, so a
    // capped cache is the textbook sequential-scan worst case: once the
    // session is longer than the cap, each lookup evicts the entry the next
    // lookup wants and the hit rate falls to zero with no symptom but a
    // creeping cost. One entry per closed segment is bounded by the trail,
    // which the tracker already keeps in full.
    if (!open) this.cache.set(key, out);
    return out;
  }

  /**
   * @param settled true once the decoder has been silent long enough that
   *   nothing more is coming for the current tail — the cursor word and the
   *   last few chars are then judged like everything else.
   */
  verdicts(settled = false): WordVerdict[] {
    const t = this.tracker;
    const { cfg } = t;
    if (t.revision !== this.cachedRevision) {
      // A retract rewrote the heard stream; spans keyed by offset may now
      // describe chars that no longer exist.
      this.cache = new Map();
      this.cachedRevision = t.revision;
    }
    const segs = this.segments();
    const spans = new Map<number, Span>();
    let lastRun = 0;
    segs.forEach((seg, k) => {
      lastRun = seg.run;
      for (const [w, s] of this.spansOf(seg, k === segs.length - 1)) spans.set(w, s);
    });
    if (spans.size === 0) return [];
    let minWord = Infinity;
    let maxWord = -Infinity;
    for (const w of spans.keys()) {
      if (w < minWord) minWord = w;
      if (w > maxWord) maxWord = w;
    }
    const heardLen = t.heard.length;
    const cursorWord = t.cursorWord;
    // The cursor word is still being said — except at the very end of the
    // reference, where nothing can follow it and it settles like any other.
    const cursorPending = !t.reachedEnd && !settled;
    const dwell = settled ? 0 : cfg.commitDwell;
    const out: WordVerdict[] = [];
    for (let w = 0; w < t.wordCount; w++) {
      const span = spans.get(w);
      const pending =
        (w === cursorWord && cursorPending) ||
        (span !== undefined && span.to > heardLen - dwell) ||
        (span !== undefined && span.run < lastRun && w >= cursorWord);
      const expFrom = t.localWordStart[w];
      const expTo = w + 1 < t.wordCount ? t.localWordStart[w + 1] : t.length;
      const expLen = expTo - expFrom;
      const heardCount = span ? span.to - span.from : 0;
      const g = t.firstWord + w;
      const ref = t.corpus.ref(g);
      if (!pending && heardCount < cfg.minHeardFraction * expLen) {
        if (w > minWord && w < maxWord) {
          out.push({ ...ref, state: "skipped", distance: 1, heardRatio: heardCount / expLen, margin: 0 });
        }
        continue;
      }
      if (!span) continue;
      const heard = Uint8Array.from(t.heardIds.slice(span.from, span.to));
      const expected = t.ref.subarray(expFrom, expTo);
      let distance = normalizedDistance(heard, expected, t.table);
      // A reciter may stop on ANY word, and stopping changes its ending — see
      // waqf.ts. When a real pause follows, the word is judged against
      // whichever form is nearer, over everything said up to that silence.
      // Correct flow still matches the flowing form at 0, a real mistake
      // matches neither form, and without the pause nothing here applies — so
      // this can only remove false reds, never hide a mistake behind a stop
      // that did not happen.
      if (distance > cfg.okDistance) {
        const pausal = this.pausalOf(w);
        if (pausal) {
          const stop = this.stopBoundary(span);
          if (stop >= 0) {
            const uttered = stop === span.to ? heard : Uint8Array.from(t.heardIds.slice(span.from, stop));
            const stopped = normalizedDistance(uttered, pausal, t.table);
            if (stopped < distance) distance = stopped;
          }
        }
      }
      let margin = 0;
      for (let i = span.from; i < span.to; i++) margin += t.heard[i].margin;
      margin /= Math.max(1, span.to - span.from);
      let state: WordState;
      if (pending) state = "pending";
      else if (distance <= cfg.okDistance) state = "ok";
      else if (distance <= cfg.unsureDistance || margin < cfg.minMargin) state = "unsure";
      else state = "wrong";
      out.push({ ...ref, state, distance, heardRatio: heardCount / expLen, margin });
    }
    return out;
  }
}
