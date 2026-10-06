import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QuranCorpus, QuranIndex, type HeardChar, type HeardToken, type QuranData } from "../src/core/index.js";

const here = dirname(fileURLToPath(import.meta.url));

let corpus: QuranCorpus | undefined;
export function loadCorpus(): QuranCorpus {
  if (!corpus) {
    const data = JSON.parse(readFileSync(resolve(here, "../data/quran.json"), "utf8")) as QuranData;
    corpus = new QuranCorpus(data);
  }
  return corpus;
}

let index: QuranIndex | undefined;
export function loadIndex(): QuranIndex {
  return (index ??= new QuranIndex(loadCorpus()));
}

/** Phoneme text of a stretch of words (global indices, [from, to)). */
export function phonemesOf(from: number, to: number): string {
  const c = loadCorpus();
  return c.text.slice(c.wordStart[from], c.wordStart[to]);
}

/** Phoneme text of whole ayahs. */
export function ayahText(surah: number, fromAyah: number, toAyah = fromAyah): string {
  const c = loadCorpus();
  const from = c.ayahFirstWord(surah, fromAyah);
  const to = c.ayahFirstWord(surah, toAyah) + c.ayahWordCount(surah, toAyah);
  return phonemesOf(from, to);
}

/** One HeardChar per char, frames advancing ~2.5 per char (10 chars/s), margin 1. */
export function chars(text: string, startFrame = 0, margin = 1): HeardChar[] {
  return [...text].map((ch, i) => ({ ch, frame: startFrame + Math.floor(i * 2.5), margin }));
}

/** One single-char token per char. */
export function tokens(text: string, startFrame = 0, margin = 1): HeardToken[] {
  return [...text].map((sym, i) => ({ sym, frame: startFrame + Math.floor(i * 2.5), margin }));
}

/** Deterministic pseudo-random substitution of a fraction of letters. */
export function garble(text: string, fraction: number, seed = 1): string {
  const letters = "بتثجحخدذرزسشصضطظعغفقكلمنهوي";
  let s = seed;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return [...text]
    .map((ch) => {
      if (rnd() < fraction && letters.includes(ch)) {
        let r = letters[Math.floor(rnd() * letters.length)];
        if (r === ch) r = letters[(letters.indexOf(ch) + 1) % letters.length];
        return r;
      }
      return ch;
    })
    .join("");
}
