/**
 * Graded per-character substitution costs between phoneme characters.
 *
 * Ported from the iOS engine's `PhonemeCost` (PhonemeSimilarity.swift) and
 * flattened to single characters so the online DP can look costs up in a
 * table instead of comparing strings:
 *
 * - 0.0   identical, or model-notation variants of one letter (ۦ/ي ۥ/و ں/ن ۾/م ٱ/ا ى/ي)
 * - 0.1   hamza family (ء أ إ آ ا ؤ ئ ٲ) — the model mixes these constantly
 * - 0.1   one short vowel heard for another (َ ُ ِ)
 * - 0.25  acoustic neighbours the model routinely confuses (س/ص، ك/ق …)
 * - 0.25  two different diacritical marks that are not both short vowels
 *         (a short vowel vs the sukun/qalqalah marker ڇ, etc.)
 * - 1.0   unrelated sounds, and a letter vs a mark
 *
 * ه ع ح غ خ are deliberately NOT in the hamza family (the old binary group
 * lumped all nine as free, which let بِهِ falsely match inside آبائهم).
 */

const BASE_LETTERS = "ءابتثجحخدذرزسشصضطظعغفقكلمنهويۥۦں۾ٲأإآؤئٱى";
/** Short vowels. */
const HARAKAT = "َُِ";
/** Other diacritical marks the model emits (sukun/qalqalah ڇ, tatweel, rare marks). */
const MARKS = "ڇؙۣ۪ٞۜـ";

const CANONICAL: Record<string, string> = {
  "ۦ": "ي",
  "ۥ": "و",
  "ں": "ن",
  "۾": "م",
  "ٱ": "ا",
  "ى": "ي",
};

const HAMZA_FAMILY = new Set("ءأإآاؤئٲ");
const NEIGHBOR_GROUPS = ["ذدضتط", "ظزذصسث", "جزش", "ةهت", "قكغ", "فبم"];
const NEIGHBOR_PAIRS: [string, string][] = [
  ["ه", "ح"],
  ["غ", "خ"],
  ["ء", "ع"],
  ["ن", "م"],
  ["ن", "ل"],
  ["ظ", "ض"],
];

export const HAMZA_COST = 0.1;
export const HARAKA_COST = 0.1;
export const NEIGHBOR_COST = 0.25;
export const MARK_COST = 0.25;

export function canonical(ch: string): string {
  return CANONICAL[ch] ?? ch;
}

export function isHaraka(ch: string): boolean {
  return HARAKAT.includes(ch);
}

export function isMark(ch: string): boolean {
  return HARAKAT.includes(ch) || MARKS.includes(ch);
}

/** Long-vowel letters — repeat-count differences on these are madd length. */
export function isMaddLetter(ch: string): boolean {
  return "اوي".includes(canonical(ch));
}

const neighborKeys = new Set<string>();
for (const group of NEIGHBOR_GROUPS) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) neighborKeys.add(group[i] < group[j] ? group[i] + group[j] : group[j] + group[i]);
  }
}
for (const [a, b] of NEIGHBOR_PAIRS) neighborKeys.add(a < b ? a + b : b + a);

/** Cost of hearing character `heard` where `expected` was expected. */
export function charCost(heard: string, expected: string): number {
  if (heard === expected) return 0;
  const a = canonical(heard);
  const b = canonical(expected);
  if (a === b) return 0;
  const aMark = isMark(a);
  const bMark = isMark(b);
  if (aMark || bMark) {
    if (aMark && bMark) return isHaraka(a) && isHaraka(b) ? HARAKA_COST : MARK_COST;
    return 1;
  }
  if (HAMZA_FAMILY.has(a) && HAMZA_FAMILY.has(b)) return HAMZA_COST;
  const key = a < b ? a + b : b + a;
  if (neighborKeys.has(key)) return NEIGHBOR_COST;
  return 1;
}

/**
 * A dense cost table over a fixed alphabet, for the DP inner loop.
 * Characters outside the alphabet map to `unknownId`, which costs 1 against
 * everything (including itself — they are vanishingly rare: 5 occurrences
 * in the whole Quran).
 */
export class CostTable {
  readonly alphabet: string;
  readonly size: number;
  readonly unknownId: number;
  private readonly ids = new Map<string, number>();
  /** cost[heardId * size + expectedId] */
  readonly cost: Float32Array;

  constructor() {
    this.alphabet = BASE_LETTERS + HARAKAT + MARKS;
    this.size = this.alphabet.length + 1;
    this.unknownId = this.alphabet.length;
    for (let i = 0; i < this.alphabet.length; i++) this.ids.set(this.alphabet[i], i);
    this.cost = new Float32Array(this.size * this.size);
    for (let h = 0; h < this.size; h++) {
      for (let e = 0; e < this.size; e++) {
        this.cost[h * this.size + e] =
          h === this.unknownId || e === this.unknownId ? 1 : charCost(this.alphabet[h], this.alphabet[e]);
      }
    }
  }

  id(ch: string): number {
    return this.ids.get(ch) ?? this.unknownId;
  }

  /** Encode a string to ids. */
  encode(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = this.id(text[i]);
    return out;
  }

  costOf(heardId: number, expectedId: number): number {
    return this.cost[heardId * this.size + expectedId];
  }
}

let shared: CostTable | undefined;
export function costTable(): CostTable {
  return (shared ??= new CostTable());
}
