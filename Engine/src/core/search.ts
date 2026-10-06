import { alignSemiGlobal, normalizedDistance } from "./alignment.js";
import type { QuranCorpus } from "./corpus.js";
import { costTable, type CostTable } from "./phonemeCost.js";
import { DEFAULT_CONFIG, type AyahRef, type EngineConfig, type SearchHit, type SearchResult } from "./types.js";

const GRAM = 5;
const BUCKET_BITS = 18;
const BUCKETS = 1 << BUCKET_BITS;
const WINDOW_BITS = 5;
const MAX_POSTINGS = 400;
const CANDIDATE_WINDOWS = 24;
const VERIFY_MARGIN_BEFORE = 16;
const VERIFY_MARGIN_AFTER = 32;
/** A decisive hit must have aligned at least this many query chars. */
const MIN_ALIGNED = 20;
/** Unmatchable separator run between surahs in the indexed stream. */
const SURAH_GAP = 8;

/** أعوذ بالله من الشيطان الرجيم — hand-authored, it is not Quran text. */
export const ISTIADHA = "ءَعُۥۥذُبِللَااهِمِنَششَييطَاانِررَجِۦۦم";
/** بسم الله الرحمن الرحيم — the reference spelling of 1:1. */
export const BASMALA = "بِسمِللَااهِررَحمَاانِررَحِۦۦۦۦم";
const PREAMBLE_MAX_DISTANCE = 0.3;
/** The tail re-searched when the full query is not decisive. */
const SHORT_QUERY = 100;

/** True while the query could still be an استعاذة being said (a prefix of it, ±4 chars). */
export function isGrowingIstiadha(query: string, table: CostTable): boolean {
  if (query.length > ISTIADHA.length + 4) return false;
  const head = ISTIADHA.slice(0, Math.min(ISTIADHA.length, query.length));
  return normalizedDistance(table.encode(query), table.encode(head), table) <= 0.35;
}

/**
 * Strips a leading استعاذة and/or basmala when the query's head is a close
 * rendering of them (length may drift by a few chars either way).
 */
export function stripPreambles(query: string, table: CostTable): { offset: number; basmala: boolean; basmalaOffset: number } {
  let offset = 0;
  let basmala = false;
  let basmalaOffset = 0;
  for (const phrase of [ISTIADHA, BASMALA]) {
    const ids = table.encode(phrase);
    let bestLen = -1;
    let bestDist = Infinity;
    for (let len = phrase.length - 4; len <= phrase.length + 4; len++) {
      if (len <= 0 || offset + len > query.length) continue;
      const d = normalizedDistance(table.encode(query.slice(offset, offset + len)), ids, table);
      if (d < bestDist) {
        bestDist = d;
        bestLen = len;
      }
    }
    if (bestLen > 0 && bestDist <= PREAMBLE_MAX_DISTANCE) {
      if (phrase === BASMALA) {
        basmala = true;
        basmalaOffset = offset;
      }
      offset += bestLen;
    }
  }
  return { offset, basmala, basmalaOffset };
}

/**
 * Whole-Quran search: a 5-gram hash index over the corpus phoneme text votes
 * for 32-char windows, the top windows are verified by semi-global alignment
 * (query head may be skipped — استعاذة, garbage), and the best few become
 * hits. `decisive` means the best hit clears the distance bar and beats the
 * runner-up by the margin.
 */
export class QuranIndex {
  readonly corpus: QuranCorpus;
  readonly cfg: EngineConfig;
  readonly table: CostTable;
  private readonly ids: Uint8Array;
  private readonly bucketStart: Int32Array;
  private readonly postings: Int32Array;

  /** Index offsets where each surah begins (in the separated id stream). */
  private readonly surahStartIdx: Int32Array;
  /** Corpus char offset where each surah begins. */
  private readonly surahStartCorpus: Int32Array;

  constructor(corpus: QuranCorpus, cfg: EngineConfig = DEFAULT_CONFIG) {
    this.corpus = corpus;
    this.cfg = cfg;
    this.table = costTable();
    // The indexed stream carries a run of unmatchable separators between
    // surahs, so an alignment cannot walk from the end of one surah into
    // the start of the next (the corpus text itself is contiguous).
    const sep = new Uint8Array(SURAH_GAP).fill(this.table.unknownId);
    const parts: Uint8Array[] = [];
    this.surahStartIdx = new Int32Array(corpus.surahs.length);
    this.surahStartCorpus = new Int32Array(corpus.surahs.length);
    let at = 0;
    corpus.surahs.forEach((s, i) => {
      if (i > 0) {
        parts.push(sep);
        at += SURAH_GAP;
      }
      const from = corpus.wordStart[s.firstWord];
      const to = corpus.wordStart[s.endWord];
      this.surahStartIdx[i] = at;
      this.surahStartCorpus[i] = from;
      parts.push(this.table.encode(corpus.text.slice(from, to)));
      at += to - from;
    });
    this.ids = new Uint8Array(at);
    let off = 0;
    for (const p of parts) {
      this.ids.set(p, off);
      off += p.length;
    }
    const n = this.ids.length - GRAM + 1;
    const counts = new Int32Array(BUCKETS + 1);
    for (let i = 0; i < n; i++) counts[this.hashAt(this.ids, i) + 1]++;
    for (let b = 0; b < BUCKETS; b++) counts[b + 1] += counts[b];
    this.bucketStart = counts;
    const fill = counts.slice(0, BUCKETS);
    this.postings = new Int32Array(Math.max(0, n));
    for (let i = 0; i < n; i++) this.postings[fill[this.hashAt(this.ids, i)]++] = i;
  }

  /** Map an offset in the separated id stream back to a corpus char offset. */
  private toCorpus(idx: number): number {
    let lo = 0;
    let hi = this.surahStartIdx.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.surahStartIdx[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    const within = idx - this.surahStartIdx[lo];
    const s = this.corpus.surahs[lo];
    const len = this.corpus.wordStart[s.endWord] - this.surahStartCorpus[lo];
    return this.surahStartCorpus[lo] + Math.min(within, len);
  }

  private hashAt(ids: Uint8Array, at: number): number {
    let h = 2166136261;
    for (let k = 0; k < GRAM; k++) {
      h ^= ids[at + k];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) & (BUCKETS - 1);
  }

  /**
   * @param query heard phoneme text (the last few hundred chars).
   * @param hint order-only tie-break toward this ayah (the prompter's Fatiha hint).
   */
  search(query: string, hint: AyahRef | null = null, limit = 3): SearchResult {
    const { cfg } = this;
    if (query.length < cfg.searchMinChars) return { hits: [], decisive: false };
    // A long garbage head (room noise, talk) can outweigh a short genuine
    // tail; the tail alone is searched too and a decisive answer wins.
    const full = this.searchOnce(query, hint, limit);
    if (full.decisive || query.length <= SHORT_QUERY) return full;
    const short = this.searchOnce(query.slice(-SHORT_QUERY), hint, limit);
    if (!short.decisive) return full;
    for (const h of short.hits) h.queryStart += query.length - SHORT_QUERY;
    return short;
  }

  private searchOnce(query: string, hint: AyahRef | null, limit: number): SearchResult {
    const { cfg } = this;
    // While the head is still a plausible, growing استعاذة, no lock: the
    // phrase nearly matches 16:98 (فَٱسْتَعِذْ بِٱللَّهِ…) and أعوذ بالله is
    // literal Quran at 2:67. A genuine reciter of either diverges from it
    // within a few chars and is released then.
    if (isGrowingIstiadha(query, this.table)) return { hits: [], decisive: false };
    // Opening phrases: an استعاذة is never Quran text; a basmala is 1:1 and
    // 27:30 but is recited before every surah, so it is searched WITHOUT it
    // and a hit at the start of 1:2 collapses back to 1:1 (the basmala then
    // counts toward that hit's aligned length).
    const stripped = stripPreambles(query, this.table);
    const rest = query.slice(stripped.offset);
    if (rest.length < cfg.searchMinChars) return { hits: [], decisive: false };
    if (stripped.basmala) {
      // The basmala IS Quran text at 1:1 (and inside 27:30): if the whole
      // query, basmala included, aligns there decisively, that wins — it is
      // what separates «بسم الله… الحمد لله رب العالمين» at 1:1 from the same
      // words at 6:45 or 37:182.
      const whole = this.decide(this.searchRaw(query.slice(stripped.basmalaOffset), hint, limit), query.length - stripped.basmalaOffset, 0);
      if (whole.decisive && whole.hits[0].queryStart <= 2) {
        for (const h of whole.hits) h.queryStart += stripped.basmalaOffset;
        return whole;
      }
    }
    const raw = this.searchRaw(rest, hint, limit);
    if (!raw) return { hits: [], decisive: false };
    let bonus = 0;
    for (const h of raw.hits) {
      if (stripped.basmala && h.surah === 1 && h.ayah === 2 && h.word <= 3) {
        if (h === raw.best) bonus = stripped.offset - stripped.basmalaOffset;
        Object.assign(h, this.corpus.ref(0), { refOffset: 0, queryStart: stripped.basmalaOffset });
      } else {
        h.queryStart += stripped.offset;
      }
    }
    return this.decide(raw, rest.length, bonus);
  }

  private decide(
    raw: { hits: SearchHit[]; best: SearchHit; rivals: SearchHit[]; bestQueryStart: number } | null,
    queryLength: number,
    alignedBonus: number,
  ): SearchResult {
    if (!raw) return { hits: [], decisive: false };
    const { cfg } = this;
    const aligned = queryLength - raw.bestQueryStart + alignedBonus;
    const runnerUp = raw.rivals[0];
    const decisive =
      raw.best.distance <= cfg.searchDecisiveDistance &&
      aligned >= MIN_ALIGNED &&
      (runnerUp === undefined || runnerUp.distance - raw.best.distance >= cfg.searchDecisiveMargin);
    return { hits: raw.hits, decisive };
  }

  private searchRaw(query: string, hint: AyahRef | null, limit: number): { hits: SearchHit[]; best: SearchHit; rivals: SearchHit[]; bestQueryStart: number } | null {
    const { cfg } = this;
    const q = this.table.encode(query);
    const votes = new Map<number, number>();
    for (let u = 0; u + GRAM <= q.length; u++) {
      const b = this.hashAt(q, u);
      const s = this.bucketStart[b];
      const e = this.bucketStart[b + 1];
      if (e - s > MAX_POSTINGS) continue;
      for (let k = s; k < e; k++) {
        const w = (this.postings[k] - u) >> WINDOW_BITS;
        votes.set(w, (votes.get(w) ?? 0) + 1);
      }
    }
    if (votes.size === 0) return null;
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, CANDIDATE_WINDOWS);
    const verified: SearchHit[] = [];
    for (const [w] of top) {
      const start = w << WINDOW_BITS;
      const from = Math.max(0, start - VERIFY_MARGIN_BEFORE);
      const to = Math.min(this.ids.length, start + q.length + VERIFY_MARGIN_AFTER);
      if (to <= from) continue;
      const r = alignSemiGlobal(q, this.ids, from, to, this.table);
      if (q.length - r.queryStart < cfg.searchMinChars) continue;
      const refOffset = this.toCorpus(r.refStart);
      const refEnd = this.toCorpus(r.refEnd);
      if (refEnd <= refOffset) continue; // aligned only onto separators
      const wordIndex = this.corpus.wordAt(refOffset);
      verified.push({ ...this.corpus.ref(wordIndex), refOffset, refEnd, queryStart: r.queryStart, distance: r.distance });
    }
    verified.sort((a, b) => a.distance - b.distance || a.wordIndex - b.wordIndex);
    // One hit per stretch of text: a worse alignment overlapping a better
    // one is the same place found from a neighbouring window, not a rival.
    const hits: SearchHit[] = [];
    for (const h of verified) {
      if (hits.some((k) => h.refOffset < k.refEnd && k.refOffset < h.refEnd)) continue;
      hits.push(h);
    }
    if (hits.length === 0) return null;

    // Hint: among hits tied with the best (within the decisive margin), prefer
    // the one nearest the hinted ayah; the other tie members then stop
    // counting as rivals.
    let best = hits[0];
    let rivals = hits.slice(1);
    if (hint) {
      const tieCut = best.distance + cfg.searchDecisiveMargin;
      const tie = hits.filter((h) => h.distance <= tieCut);
      const hintWord = this.corpus.ayahFirstWord(hint.surah, hint.ayah);
      const inSurah = tie.filter((h) => h.surah === hint.surah);
      if (inSurah.length > 0) {
        inSurah.sort((a, b) => Math.abs(a.wordIndex - hintWord) - Math.abs(b.wordIndex - hintWord) || a.wordIndex - b.wordIndex);
        best = inSurah[0];
        rivals = hits.filter((h) => h !== best && !tie.includes(h));
      }
    }
    const ordered = [best, ...hits.filter((h) => h !== best)].slice(0, limit);
    return { hits: ordered, best, rivals, bestQueryStart: best.queryStart };
  }
}
