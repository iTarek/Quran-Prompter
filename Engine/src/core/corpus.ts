import type { AyahRef } from "./types.js";

/**
 * The shape of `data/quran.json` (generated from Quran Lab's phoneme reference).
 * Per word: `[mushaf glyphs, phonemes, plain text]`. The mushaf glyphs are the
 * private-use encoding that renders only in "KFGQPC Hafs Smart"; `m` is the
 * ayah-end ornament in that same encoding.
 */
export interface QuranData {
  v: number;
  surahs: {
    n: number;
    name: string;
    nameEn: string;
    ayahs: { n: number; m: string; w: [string, string, string][] }[];
  }[];
}

export interface SurahInfo {
  n: number;
  /** Arabic name, e.g. الفَاتِحة. */
  name: string;
  /** Transliterated name, e.g. Al-Fātiḥah. */
  nameEn: string;
  ayahCount: number;
  firstWord: number;
  /** Exclusive. */
  endWord: number;
}

/**
 * The whole Quran as one phoneme string plus word tables. Every phoneme
 * character is a BMP code unit, so `text[i]` is one phoneme and char offsets
 * index the string directly. The search index and every tracker share this
 * coordinate system: a tracker range is a `[charStart, charEnd)` slice of
 * `text`, and a search hit is a char offset into it.
 */
export class QuranCorpus {
  readonly text: string;
  /** Char offset of each word; length = wordCount + 1, last = text.length. */
  readonly wordStart: Int32Array;
  readonly wordSurah: Int32Array;
  readonly wordAyah: Int32Array;
  readonly wordInAyah: Int32Array;
  readonly surahs: SurahInfo[];
  readonly wordCount: number;
  /** Mushaf (private-use) glyphs per word — what the page renders. */
  private readonly mushaf: string[];
  /** Plain Unicode per word — for labels, copying and search. */
  private readonly plain: string[];
  /** Ayah-end ornament per surah, indexed by ayah - 1. */
  private readonly markers: string[][];
  /** ayahFirst[surahIndex][ayahIndex] = global word index of that ayah's first word. */
  private readonly ayahFirst: Int32Array[];
  /** ayahWordCount[surahIndex][ayahIndex]. */
  private readonly ayahWords: Int32Array[];

  constructor(data: QuranData) {
    if (data.v !== 2) throw new Error(`quran.json v${data.v} unsupported`);
    let count = 0;
    for (const s of data.surahs) for (const a of s.ayahs) count += a.w.length;
    this.wordCount = count;
    this.wordStart = new Int32Array(count + 1);
    this.wordSurah = new Int32Array(count);
    this.wordAyah = new Int32Array(count);
    this.wordInAyah = new Int32Array(count);
    this.mushaf = new Array(count);
    this.plain = new Array(count);
    this.markers = [];
    this.surahs = [];
    this.ayahFirst = [];
    this.ayahWords = [];
    const parts: string[] = [];
    let w = 0;
    let offset = 0;
    for (const s of data.surahs) {
      const first = new Int32Array(s.ayahs.length);
      const counts = new Int32Array(s.ayahs.length);
      const marks: string[] = [];
      const firstWord = w;
      s.ayahs.forEach((a, ai) => {
        if (a.n !== ai + 1) throw new Error(`surah ${s.n}: ayah ${a.n} at index ${ai}`);
        first[ai] = w;
        counts[ai] = a.w.length;
        marks.push(a.m);
        a.w.forEach(([mushafWord, ph, textWord], wi) => {
          this.wordStart[w] = offset;
          this.wordSurah[w] = s.n;
          this.wordAyah[w] = a.n;
          this.wordInAyah[w] = wi;
          this.mushaf[w] = mushafWord;
          this.plain[w] = textWord;
          parts.push(ph);
          offset += ph.length;
          w++;
        });
      });
      this.surahs.push({ n: s.n, name: s.name, nameEn: s.nameEn, ayahCount: s.ayahs.length, firstWord, endWord: w });
      this.ayahFirst.push(first);
      this.ayahWords.push(counts);
      this.markers.push(marks);
    }
    this.wordStart[count] = offset;
    this.text = parts.join("");
    if (this.text.length !== offset) throw new Error("phoneme offsets disagree");
    if (this.surahs.length !== 114) throw new Error(`${this.surahs.length} surahs`);
  }

  surah(n: number): SurahInfo {
    const s = this.surahs[n - 1];
    if (!s || s.n !== n) throw new Error(`no surah ${n}`);
    return s;
  }

  ayahCount(surah: number): number {
    return this.surah(surah).ayahCount;
  }

  /**
   * Whether this ayah exists — the question to ask about anything that came
   * from outside, since `ayahCount` THROWS on an unknown surah and every
   * caller would otherwise have to bound the surah before it could bound the
   * ayah. A saved position out of a browser's storage is exactly that.
   */
  hasAyah(surah: number, ayah: number): boolean {
    if (!Number.isInteger(surah) || surah < 1 || surah > this.surahs.length) return false;
    return Number.isInteger(ayah) && ayah >= 1 && ayah <= this.surahs[surah - 1].ayahCount;
  }

  /**
   * Position of an ayah among all 6,236, 0-based — the key the page table is
   * built on. Computed rather than stored: 114 additions at most, and one
   * fewer array that could fall out of step with the corpus.
   */
  ayahOrdinal(surah: number, ayah: number): number {
    if (ayah < 1 || ayah > this.ayahCount(surah)) throw new Error(`no ayah ${surah}:${ayah}`);
    let n = 0;
    for (let s = 1; s < surah; s++) n += this.ayahCount(s);
    return n + ayah - 1;
  }

  /** Global index of an ayah's first word. */
  ayahFirstWord(surah: number, ayah: number): number {
    const first = this.ayahFirst[surah - 1];
    if (!first || ayah < 1 || ayah > first.length) throw new Error(`no ayah ${surah}:${ayah}`);
    return first[ayah - 1];
  }

  ayahWordCount(surah: number, ayah: number): number {
    return this.ayahWords[surah - 1][ayah - 1];
  }

  /** Global index of a word given surah/ayah/word-in-ayah. */
  wordIndex(surah: number, ayah: number, word: number): number {
    const idx = this.ayahFirstWord(surah, ayah) + word;
    if (word < 0 || word >= this.ayahWordCount(surah, ayah)) throw new Error(`no word ${surah}:${ayah} w${word}`);
    return idx;
  }

  /** The word whose phonemes contain `charOffset` (binary search). */
  wordAt(charOffset: number): number {
    if (charOffset < 0) return 0;
    if (charOffset >= this.text.length) return this.wordCount - 1;
    let lo = 0;
    let hi = this.wordCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.wordStart[mid] <= charOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** What the page draws: mushaf glyphs, for "KFGQPC Hafs Smart". */
  displayWord(wordIndex: number): string {
    return this.mushaf[wordIndex];
  }

  /** Plain Unicode — never render this in the mushaf font, which draws only its own glyphs. */
  plainWord(wordIndex: number): string {
    return this.plain[wordIndex];
  }

  /** The ayah-end ornament, in the mushaf encoding. */
  ayahMarker(surah: number, ayah: number): string {
    return this.markers[surah - 1][ayah - 1] ?? "";
  }

  phonemes(wordIndex: number): string {
    return this.text.slice(this.wordStart[wordIndex], this.wordStart[wordIndex + 1]);
  }

  ref(wordIndex: number): AyahRef & { word: number; wordIndex: number } {
    return {
      surah: this.wordSurah[wordIndex],
      ayah: this.wordAyah[wordIndex],
      word: this.wordInAyah[wordIndex],
      wordIndex,
    };
  }
}
