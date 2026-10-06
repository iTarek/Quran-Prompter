import type { QuranCorpus } from "./corpus.js";
import type { QuranIndex } from "./search.js";
import { Tracker } from "./tracker.js";
import {
  DEFAULT_CONFIG,
  type AyahRef,
  type EngineConfig,
  type EngineEvent,
  type HeardChar,
  type HeardToken,
  type SearchHit,
  type WordState,
  type WordVerdict,
} from "./types.js";
import { VerdictTracer } from "./verdicts.js";

const BUFFER_CAP = 1000;

/**
 * The prompter-shaped state machine: `searching` (whole-Quran locate on the
 * recent phonemes) ⇄ `tracking` (one surah loaded in a Tracker). Pure and
 * frame-clocked — feed it decoder tokens plus the running output-frame count
 * (25 frames per second) and it returns events. The host owns what to do
 * with `idle`, `completed` and `locateFailed` (the prompter goes back to
 * searching on the first two and keeps listening on the third).
 */
export class RecitationEngine {
  readonly corpus: QuranCorpus;
  readonly index: QuranIndex;
  readonly cfg: EngineConfig;
  private _state: "searching" | "tracking" = "searching";
  private _tracker: Tracker | null = null;
  private tracer: VerdictTracer | null = null;
  private hint: AyahRef | null = null;
  /** See `setStayOnSurah` — locate once, then never leave. */
  private stay = false;
  private buffer: HeardChar[] = [];
  private framesDecoded = 0;
  private searchStartFrame = 0;
  private lastSearchFrame = 0;
  private lastSearchChars = 0;
  /**
   * Chars heard since this search began. NOT `buffer.length`: the buffer is
   * capped at BUFFER_CAP, so once it saturates its length never changes again
   * and any "how much is new" test derived from it reads zero forever — which
   * silently stopped the search from ever firing after ~a minute of sound.
   */
  private heardTotal = 0;
  private locateFailedEmitted = false;
  private lastRelocateFrame = 0;
  private lastProgressFrame = 0;
  private lostEmitted = false;
  /**
   * Consecutive relocate checks that heard new speech, found the tracker
   * lost, and had no relocation to rescue it. At `cfg.maxStruggles` the run
   * ends. Reset by the tracker
   * matching again.
   */
  private struggles = 0;
  /** `heardTotal` at the last relocate check — how much is new since. */
  private lastStruggleChars = 0;
  private completedEmitted = false;
  private relocateCandidate: AyahRef | null = null;
  /** The last `hearing` guess sent, so an unchanged one is not sent again. */
  private lastHearing = "";
  private lastStates = new Map<number, WordState>();
  private lastCursorWord = -1;
  private lastCharFrame = 0;

  constructor(corpus: QuranCorpus, index: QuranIndex, cfg: EngineConfig = DEFAULT_CONFIG) {
    this.corpus = corpus;
    this.index = index;
    this.cfg = cfg;
  }

  get state(): "searching" | "tracking" {
    return this._state;
  }

  get tracker(): Tracker | null {
    return this._tracker;
  }

  /** Recent heard phoneme text (what a search sees). */
  get heardText(): string {
    return this.buffer.map((c) => c.ch).join("");
  }

  setHint(hint: AyahRef | null): void {
    this.hint = hint;
  }

  /**
   * Locate once, then never leave this surah — for a host whose reciter is
   * reading rather than praying.
   *
   * The tracker still runs: words are still coloured and the cursor still
   * moves. What stops is every path that would END the run — the relocation
   * search and the `idle` the struggle counter raises. **`idle` for silence is
   * deliberately left alone**: it is the honest "nothing is arriving" signal
   * and what it means is the host's decision, not this flag's.
   */
  setStayOnSurah(stay: boolean): void {
    this.stay = stay;
  }

  /** Drop any loaded surah and start locating afresh from the next sounds. */
  startSearch(): void {
    this._state = "searching";
    this._tracker = null;
    this.tracer = null;
    this.buffer = [];
    this.searchStartFrame = this.framesDecoded;
    this.lastSearchFrame = this.framesDecoded;
    this.lastSearchChars = 0;
    this.heardTotal = 0;
    this.locateFailedEmitted = false;
    this.relocateCandidate = null;
    this.lastHearing = "";
    this.struggles = 0;
    this.lastStruggleChars = this.heardTotal;
    this.lastStates.clear();
    this.lastCursorWord = -1;
  }

  /** Load a known position directly (a host that already knows the ayah). */
  track(surah: number, ayah: number, word = 0): EngineEvent[] {
    const wordIndex = this.corpus.wordIndex(surah, ayah, word);
    this.buffer = [];
    return this.lock(wordIndex, [], "located");
  }

  feed(tokens: HeardToken[], framesDecoded: number): EngineEvent[] {
    if (framesDecoded < this.framesDecoded) {
      // The decoder's frame clock restarted — a host that resets the decoder
      // alongside `startSearch` (the prompter does exactly that, and resets
      // second). Every baseline still holds the old, higher frame number, so
      // without rebasing them every delta below goes negative and the timers
      // simply stop firing: `locateFailed` went silent for the rest of the
      // session after the first re-search.
      this.searchStartFrame = framesDecoded;
      this.lastSearchFrame = framesDecoded;
      this.lastRelocateFrame = framesDecoded;
      this.lastProgressFrame = framesDecoded;
      this.lastCharFrame = framesDecoded;
    }
    this.framesDecoded = framesDecoded;
    const chars: HeardChar[] = [];
    for (const t of tokens) for (const ch of t.sym) chars.push({ ch, frame: t.frame, margin: t.margin });
    if (chars.length) {
      this.lastCharFrame = framesDecoded;
      this.heardTotal += chars.length;
      this.buffer.push(...chars);
      if (this.buffer.length > BUFFER_CAP) this.buffer.splice(0, this.buffer.length - BUFFER_CAP);
    }
    return this._state === "searching" ? this.feedSearching(chars) : this.feedTracking(chars);
  }

  /** The decoder revised its last `n` chars. */
  retract(n: number): EngineEvent[] {
    if (n <= 0) return [];
    this.buffer.length = Math.max(0, this.buffer.length - n);
    this.heardTotal = Math.max(0, this.heardTotal - n);
    this.lastSearchChars = Math.min(this.lastSearchChars, this.heardTotal);
    if (this._tracker) {
      this._tracker.retract(n);
      return this.trackingEvents();
    }
    return [];
  }

  private query(chars = this.cfg.searchQueryChars): { text: string; start: number } {
    const start = Math.max(0, this.buffer.length - chars);
    return { text: this.buffer.slice(start).map((c) => c.ch).join(""), start };
  }

  private feedSearching(chars: HeardChar[]): EngineEvent[] {
    const { cfg } = this;
    const events: EngineEvent[] = [];
    const charsSince = this.heardTotal - this.lastSearchChars;
    const framesSince = this.framesDecoded - this.lastSearchFrame;
    const due = this.buffer.length >= cfg.searchMinChars && (charsSince >= cfg.searchEveryChars || (charsSince > 0 && framesSince >= cfg.searchEveryFrames));
    if (due) {
      this.lastSearchChars = this.heardTotal;
      this.lastSearchFrame = this.framesDecoded;
      const q = this.query();
      const result = this.index.search(q.text, this.hint);
      if (result.decisive) {
        const hit = result.hits[0];
        const replay = this.buffer.slice(q.start + hit.queryStart);
        return this.lock(hit.wordIndex, replay, "located");
      }
      // Not sure enough to lock: say what the best guess is, as words. Read
      // from the hit this search already made — the decision above is untouched.
      const best = result.hits[0];
      if (best) {
        const last = this.corpus.wordAt(best.refEnd - 1);
        const words: number[] = [];
        for (let w = best.wordIndex; w <= last; w++) words.push(w);
        const key = words.join(",");
        if (key !== this.lastHearing) {
          this.lastHearing = key;
          events.push({ type: "hearing", words });
        }
      }
    }
    if (!this.locateFailedEmitted && this.framesDecoded - this.searchStartFrame >= cfg.locateFailedFrames) {
      this.locateFailedEmitted = true;
      events.push({ type: "locateFailed" });
    }
    return events;
  }

  private lock(wordIndex: number, replay: HeardChar[], how: "located" | "relocated", from?: AyahRef): EngineEvent[] {
    const ref = this.corpus.ref(wordIndex);
    const surah = this.corpus.surah(ref.surah);
    const tracker = new Tracker(this.corpus, { surah: ref.surah, fromAyah: 1, toAyah: surah.ayahCount }, wordIndex, this.cfg);
    this._tracker = tracker;
    this.tracer = new VerdictTracer(tracker);
    this._state = "tracking";
    this.lastStates.clear();
    this.lastCursorWord = -1;
    this.lostEmitted = false;
    this.struggles = 0;
    this.lastStruggleChars = this.heardTotal;
    this.completedEmitted = false;
    this.relocateCandidate = null;
    this.lastRelocateFrame = this.framesDecoded;
    this.lastProgressFrame = this.framesDecoded;
    const events: EngineEvent[] = [];
    if (how === "located") events.push({ type: "located", surah: ref.surah, ayah: ref.ayah, word: ref.word, replayed: replay.length });
    else if (from) events.push({ type: "relocated", from, to: { surah: ref.surah, ayah: ref.ayah, word: ref.word } });
    tracker.feed(replay);
    events.push(...this.trackingEvents());
    return events;
  }

  private feedTracking(chars: HeardChar[]): EngineEvent[] {
    const { cfg } = this;
    const tracker = this._tracker!;
    tracker.feed(chars);
    const events = this.trackingEvents();
    if (tracker.lost && !this.lostEmitted) {
      this.lostEmitted = true;
      events.push({ type: "lost" });
    }
    if (!tracker.lost) this.lostEmitted = false;
    if (this.framesDecoded - this.lastRelocateFrame >= cfg.relocateEveryFrames) {
      this.lastRelocateFrame = this.framesDecoded;
      // Staying: keep the baselines moving, do none of the work — and fall
      // through, because the `silent` idle below still belongs to the host.
      // Skipping the tick outright would leave both baselines stale, so the
      // moment staying was turned back off the first check would see a whole
      // session's frames and characters at once.
      if (this.stay) {
        this.lastStruggleChars = this.heardTotal;
        this.struggles = 0;
      } else {
        const moved = this.maybeRelocate();
        if (moved) return [...events, ...moved];
        // Relocation only ever looks at OTHER surahs, so it cannot rescue a
        // reciter who has stopped reciting altogether — count those failures
        // instead. The cursor keeps walking through the garbage the whole time,
        // which is why `idleFrames` below never fires and this counter must.
        //
        // ONLY CHECKS THAT HEARD SOMETHING COUNT: `costRate` averages over heard
        // characters, so silence freezes it — an ungated counter calls a reciter
        // who merely stopped `lost`, early and repeatedly.
        const heardSince = this.heardTotal - this.lastStruggleChars;
        this.lastStruggleChars = this.heardTotal;
        // Either signal counts: the fast one catches talk within a second, the
        // slow one still catches a drift too gradual to trip it.
        if (heardSince > 0) this.struggles = tracker.lost || this.held ? this.struggles + 1 : 0;
        // 0 disables the counter — what anyone reaching for "off" tries first.
        if (cfg.maxStruggles > 0 && this.struggles >= cfg.maxStruggles) {
          this.struggles = 0;
          // Hold the `silent` timer off too, or a host that ignores `idle` gets
          // a second one on the very next feed.
          this.lastProgressFrame = this.framesDecoded;
          events.push({ type: "idle", reason: "lost" });
          return events;
        }
      }
    }
    if (this.framesDecoded - this.lastProgressFrame >= cfg.idleFrames) {
      this.lastProgressFrame = this.framesDecoded;
      events.push({ type: "idle", reason: "silent" });
    }
    return events;
  }

  /**
   * True while what is being heard does not belong to the loaded text at all:
   * the cost rate over the last `holdWindow` characters is at or above
   * `holdRate`. The alignment table always has a cheapest cell, so the cursor
   * always has somewhere to go — this is the only thing that says "nowhere".
   */
  private get held(): boolean {
    const r = this._tracker?.costRate(this.cfg.holdWindow);
    return r !== null && r !== undefined && r >= this.cfg.holdRate;
  }

  /**
   * Cursor / verdict diffs since the last call, plus completion.
   *
   * **While `held`, nothing new is shown at all** — no cursor move, no colour,
   * no completion. Measured on a test recording: 18:1 recited,
   * then ordinary speech, and the page walked eleven words of 18:2 that were
   * never recited, five of them AFTER `lost` had already fired. `lost` was
   * advisory and the cursor never stopped.
   *
   * Nothing is faked and nothing is dropped: the tracker keeps consuming the
   * audio, so the moment real recitation resumes the rate falls and the page
   * catches up to wherever the reciter actually is. Neither `lastCursorWord`
   * nor `lastStates` is touched while held, which is what makes that catch-up
   * a single move to the truth rather than a replay of the wandering.
   */
  private trackingEvents(): EngineEvent[] {
    const tracker = this._tracker!;
    const events: EngineEvent[] = [];
    if (this.held) return events;
    const cursor = tracker.cursor;
    if (cursor.wordIndex >= 0 && cursor.wordIndex !== this.lastCursorWord) {
      this.lastCursorWord = cursor.wordIndex;
      this.lastProgressFrame = this.framesDecoded;
      events.push({ type: "cursor", surah: cursor.surah, ayah: cursor.ayah, word: cursor.word, wordIndex: cursor.wordIndex });
    }
    const settled = this.framesDecoded - this.lastCharFrame >= this.cfg.settleFrames;
    const verdicts = this.tracer!.verdicts(settled);
    const changes: WordVerdict[] = [];
    const seen = new Set<number>();
    for (const v of verdicts) {
      seen.add(v.wordIndex);
      if (this.lastStates.get(v.wordIndex) !== v.state) {
        this.lastStates.set(v.wordIndex, v.state);
        changes.push(v);
      }
    }
    for (const w of [...this.lastStates.keys()]) if (!seen.has(w)) this.lastStates.delete(w);
    if (changes.length) {
      // A verdict settling on silence is the engine catching up, not the
      // reciter progressing.
      if (!settled && changes.some((c) => c.state !== "pending")) this.lastProgressFrame = this.framesDecoded;
      events.push({ type: "verdicts", changes });
    }
    if (!this.completedEmitted && tracker.reachedEnd) {
      const last = verdicts.find((v) => v.wordIndex === tracker.lastWord);
      if (last && last.state !== "pending") {
        this.completedEmitted = true;
        events.push({ type: "completed", surah: tracker.range.surah });
      }
    }
    return events;
  }

  private maybeRelocate(): EngineEvent[] | null {
    const { cfg } = this;
    const tracker = this._tracker!;
    if (this.buffer.length < cfg.searchMinChars) return null;
    const q = this.query(cfg.relocateQueryChars);
    const result = this.index.search(q.text, null, 1);
    const hit: SearchHit | undefined = result.hits[0];
    const rate = tracker.costRate();
    const candidate = hit ? { surah: hit.surah, ayah: hit.ayah } : null;
    const agrees = candidate !== null && this.relocateCandidate !== null && candidate.surah === this.relocateCandidate.surah && candidate.ayah === this.relocateCandidate.ayah;
    this.relocateCandidate = candidate;
    if (
      !hit ||
      rate === null ||
      rate < cfg.lostRate ||
      hit.surah === tracker.range.surah ||
      hit.distance > cfg.relocateMaxDistance ||
      hit.distance + cfg.relocateRateMargin > rate ||
      !agrees
    ) {
      return null;
    }
    const from = { surah: tracker.cursor.surah, ayah: tracker.cursor.ayah };
    const replay = this.buffer.slice(q.start + hit.queryStart);
    return this.lock(hit.wordIndex, replay, "relocated", from);
  }
}
