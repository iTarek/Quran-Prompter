import type { QuranCorpus } from "./corpus.js";
import { costTable, type CostTable } from "./phonemeCost.js";
import { DEFAULT_CONFIG, type Cursor, type EngineConfig, type HeardChar, type LoadRange } from "./types.js";

interface Snapshot {
  length: number;
  column: Float32Array;
  cursorCell: number;
  cursorLocalWord: number;
}

/**
 * The online alignment table.
 *
 * The reference is one contiguous stretch of the corpus (a surah for the
 * prompter). Every heard phoneme character updates ONE column of an
 * edit-distance table over the whole reference; the cursor is simply the
 * cheapest cell (ties → nearest the previous cursor). Nothing here ever
 * "decides" to move the cursor: jumps, repeats and skipped words are all
 * just cheaper or dearer paths, and the verdicts are traced back later from
 * the trail of cursor cells (see verdicts.ts).
 *
 * Restarts: at every word start the path may begin fresh at
 * `columnMin + jumpCost`, or `+ repeatCost` when that word is earlier in the
 * cursor's own ayah (a reciter repeating a phrase).
 */
export class Tracker {
  readonly corpus: QuranCorpus;
  readonly range: LoadRange;
  readonly cfg: EngineConfig;
  readonly table: CostTable;
  /** Global char offset of the reference's first char. */
  readonly charStart: number;
  /** Reference as cost-table ids. */
  readonly ref: Uint8Array;
  /** Global word index of the reference's first word. */
  readonly firstWord: number;
  /** Exclusive. */
  readonly endWord: number;
  /** For position m in 0..len: 1 if a word starts at m. */
  readonly isWordStart: Uint8Array;
  /** Positions (0..len) at which a word starts. */
  readonly wordStarts: Int32Array;
  /** For char index i in 0..len-1: local word index. */
  readonly wordOfPos: Int32Array;
  /** For position m in 0..len: ayah number of the word starting at/containing m. */
  readonly ayahOfPos: Int32Array;
  /** Local word index → its start position in the reference. */
  readonly localWordStart: Int32Array;

  private column: Float32Array;
  /** Per heard char: the cursor cell after it. */
  readonly trail: number[] = [];
  /** Per heard char: the column minimum after it (cumulative cost). */
  readonly costs: number[] = [];
  readonly heard: HeardChar[] = [];
  /** Heard chars as ids, parallel to `heard`. */
  readonly heardIds: number[] = [];
  private cursorCell = 0;
  private cursorLocalWord = -1;
  private cursorCost = 0;
  /**
   * Bumped by `retract`. Anything that caches a result derived from the heard
   * stream must drop it when this changes: a retract can be followed by new
   * audio that lands on the very same offsets, so lengths and indices alone
   * cannot tell the old stream from the new one.
   */
  private _revision = 0;
  private snapshots: Snapshot[] = [];
  private static readonly SNAPSHOT_EVERY = 32;
  private static readonly SNAPSHOT_KEEP = 16;

  constructor(corpus: QuranCorpus, range: LoadRange, startWord: number, cfg: EngineConfig = DEFAULT_CONFIG) {
    this.corpus = corpus;
    this.range = range;
    this.cfg = cfg;
    this.table = costTable();
    this.firstWord = corpus.ayahFirstWord(range.surah, range.fromAyah);
    this.endWord = corpus.ayahFirstWord(range.surah, range.toAyah) + corpus.ayahWordCount(range.surah, range.toAyah);
    if (startWord < this.firstWord || startWord >= this.endWord) throw new Error(`start word ${startWord} outside range`);
    this.charStart = corpus.wordStart[this.firstWord];
    const charEnd = corpus.wordStart[this.endWord];
    const len = charEnd - this.charStart;
    this.ref = this.table.encode(corpus.text.slice(this.charStart, charEnd));
    this.isWordStart = new Uint8Array(len + 1);
    this.wordOfPos = new Int32Array(len);
    this.ayahOfPos = new Int32Array(len + 1);
    const wordCount = this.endWord - this.firstWord;
    this.localWordStart = new Int32Array(wordCount);
    const starts: number[] = [];
    for (let w = 0; w < wordCount; w++) {
      const g = this.firstWord + w;
      const s = corpus.wordStart[g] - this.charStart;
      const e = corpus.wordStart[g + 1] - this.charStart;
      this.localWordStart[w] = s;
      this.isWordStart[s] = 1;
      starts.push(s);
      for (let i = s; i < e; i++) {
        this.wordOfPos[i] = w;
        this.ayahOfPos[i] = corpus.wordAyah[g];
      }
    }
    this.ayahOfPos[len] = corpus.wordAyah[this.endWord - 1];
    this.wordStarts = Int32Array.from(starts);
    this.startLocalWord = startWord - this.firstWord;
    this.column = new Float32Array(len + 1);
    this.resetColumn();
  }

  private readonly startLocalWord: number;

  /**
   * Initial column: the start word is free, other word starts cost a jump,
   * and every other position is reachable by deleting from the nearest word
   * start before it.
   */
  private resetColumn(): void {
    const len = this.ref.length;
    const start = this.localWordStart[this.startLocalWord];
    this.column = new Float32Array(len + 1);
    for (let m = 0; m <= len; m++) {
      if (this.isWordStart[m]) this.column[m] = m === start ? 0 : this.cfg.jumpCost;
      else this.column[m] = this.column[m - 1] + 1;
    }
    this.column[len] = Math.min(this.column[len], this.column[len - 1] + 1);
    this.cursorCell = start;
    this.cursorLocalWord = -1;
    this.cursorCost = 0;
  }

  get length(): number {
    return this.ref.length;
  }

  get wordCount(): number {
    return this.endWord - this.firstWord;
  }

  /** Global word index of the last word in the range. */
  get lastWord(): number {
    return this.endWord - 1;
  }

  get cursor(): Cursor {
    if (this.cursorLocalWord < 0) {
      return { wordIndex: -1, surah: this.range.surah, ayah: this.range.fromAyah, word: -1, cost: this.cursorCost };
    }
    const g = this.firstWord + this.cursorLocalWord;
    const r = this.corpus.ref(g);
    return { wordIndex: g, surah: r.surah, ayah: r.ayah, word: r.word, cost: this.cursorCost };
  }

  /** Reference position (0..len) of the cursor cell. */
  get cursorPosition(): number {
    return this.cursorCell;
  }

  /** Local index of the cursor word, -1 before anything matched. */
  get cursorWord(): number {
    return this.cursorLocalWord;
  }

  feed(chars: HeardChar[]): void {
    for (const c of chars) this.feedOne(c);
  }

  private feedOne(c: HeardChar): void {
    const { cfg, ref, isWordStart, ayahOfPos, wordStarts, table } = this;
    const len = ref.length;
    const prev = this.column;
    const h = table.id(c.ch);
    let colMin = Infinity;
    for (let m = 0; m <= len; m++) if (prev[m] < colMin) colMin = prev[m];
    const jump = colMin + cfg.jumpCost;
    const repeat = colMin + cfg.repeatCost;
    const cursorAyah = this.cursorLocalWord >= 0 ? this.corpus.wordAyah[this.firstWord + this.cursorLocalWord] : -1;
    const cursorPos = this.cursorCell;
    const next = new Float32Array(len + 1);
    next[0] = prev[0] + 1;
    if (isWordStart[0]) {
      const restart = ayahOfPos[0] === cursorAyah ? repeat : jump;
      if (restart < next[0]) next[0] = restart;
    }
    for (let m = 1; m <= len; m++) {
      const sub = prev[m - 1] + table.costOf(h, ref[m - 1]);
      const ins = prev[m] + 1;
      const del = next[m - 1] + 1;
      let best = sub < ins ? sub : ins;
      if (del < best) best = del;
      next[m] = best;
    }
    // Restarts at word starts — a floor, applied after the sweep so the
    // deletion chain from a restarted word start is also available.
    for (let k = 0; k < wordStarts.length; k++) {
      const m = wordStarts[k];
      const restart = m <= cursorPos && ayahOfPos[m] === cursorAyah ? repeat : jump;
      if (restart < next[m]) {
        next[m] = restart;
        // propagate deletions forward from the restart
        for (let j = m + 1; j <= len && next[j - 1] + 1 < next[j]; j++) next[j] = next[j - 1] + 1;
      }
    }
    // Argmin, ties → nearest the previous cursor cell.
    let bestCost = next[0];
    let bestCell = 0;
    let bestDist = Math.abs(0 - cursorPos);
    for (let m = 1; m <= len; m++) {
      const d = Math.abs(m - cursorPos);
      if (next[m] < bestCost || (next[m] === bestCost && d < bestDist)) {
        bestCost = next[m];
        bestCell = m;
        bestDist = d;
      }
    }
    this.column = next;
    this.heard.push(c);
    this.heardIds.push(h);
    this.trail.push(bestCell);
    this.costs.push(bestCost);
    this.cursorCell = bestCell;
    this.cursorCost = bestCost;
    this.cursorLocalWord = bestCell === 0 ? 0 : this.wordOfPos[Math.min(bestCell, len) - 1];
    if (this.heard.length % Tracker.SNAPSHOT_EVERY === 0) {
      this.snapshots.push({
        length: this.heard.length,
        column: Float32Array.from(this.column),
        cursorCell: this.cursorCell,
        cursorLocalWord: this.cursorLocalWord,
      });
      if (this.snapshots.length > Tracker.SNAPSHOT_KEEP) this.snapshots.shift();
    }
  }

  /**
   * Roll back the last `n` heard chars (a decoder that revised its tail).
   * Restores the nearest snapshot at or before the target length and replays
   * the chars between; the result is identical to never having fed them.
   */
  /** Changes whenever the heard stream is rewritten; see `_revision`. */
  get revision(): number {
    return this._revision;
  }

  retract(n: number): void {
    if (n <= 0) return;
    this._revision++;
    const target = Math.max(0, this.heard.length - n);
    const kept = this.heard.slice(0, target);
    while (this.snapshots.length && this.snapshots[this.snapshots.length - 1].length > target) this.snapshots.pop();
    const snap: Snapshot | undefined = this.snapshots[this.snapshots.length - 1];
    let replayFrom = 0;
    if (snap) {
      this.column = Float32Array.from(snap.column);
      this.cursorCell = snap.cursorCell;
      this.cursorLocalWord = snap.cursorLocalWord;
      replayFrom = snap.length;
    } else {
      this.resetColumn();
    }
    this.heard.length = replayFrom;
    this.heardIds.length = replayFrom;
    this.trail.length = replayFrom;
    this.costs.length = replayFrom;
    this.cursorCost = replayFrom > 0 ? this.costs[replayFrom - 1] : 0;
    for (let i = replayFrom; i < kept.length; i++) this.feedOne(kept[i]);
  }

  /** Cumulative cost per heard char over the last `window` chars. */
  costRate(window = this.cfg.lostWindow): number | null {
    const n = this.costs.length;
    if (n < 24) return null;
    const w = Math.min(window, n);
    const before = n - w > 0 ? this.costs[n - w - 1] : 0;
    return (this.costs[n - 1] - before) / w;
  }

  get lost(): boolean {
    const r = this.costRate();
    return r !== null && r >= this.cfg.lostRate;
  }

  /** The cursor has consumed (almost) the whole reference. */
  get reachedEnd(): boolean {
    return this.ref.length > 0 && this.cursorCell >= this.ref.length - 1;
  }
}
