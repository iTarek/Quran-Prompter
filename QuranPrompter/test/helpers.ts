import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { QuranCorpus, type QuranData } from "@alketab/quran-engine";

let corpus: QuranCorpus | null = null;

/** The real corpus, from the engine package's own data file — loaded once. */
export function loadCorpus(): QuranCorpus {
  if (corpus) return corpus;
  const path = createRequire(import.meta.url).resolve("@alketab/quran-engine/data/quran.json");
  corpus = new QuranCorpus(JSON.parse(readFileSync(path, "utf8")) as QuranData);
  return corpus;
}

/** Wait for the next animation frame (happy-dom runs them on a timer). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
