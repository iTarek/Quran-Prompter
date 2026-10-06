/**
 * The Latin reading of every word — «bismi allahi arrahmani arraheem» under
 * the Arabic, for a reciter who does not read the script well.
 *
 * **Fetched only when it is asked for.** 584 KB is more than the rest of the
 * app put together, and most reciters never open the setting, so it is not in
 * the service worker's precache (vite.config.ts EXCLUDED) and nothing here
 * runs until the switch goes on. Its URL carries the file's own content hash,
 * so the copy a browser keeps is good until the words themselves change.
 *
 * One string, split once. The file holds all 77,433 readings separated by
 * spaces rather than as a JSON array: the quoting and commas of an array cost
 * ~230 KB on their own, for nothing that survives the parse.
 *
 * A failure here is never fatal — the page simply shows no readings, which is
 * the app as it was before this file. It is a reading aid, not the recitation.
 */

declare const __TRANSLIT_VERSION__: string;
const URL_ = `/data/translit.json?v=${__TRANSLIT_VERSION__}`;

interface TranslitFile {
  v: number;
  sep: string;
  words: string;
}

let words: string[] | null = null;
let inFlight: Promise<string[] | null> | null = null;

/**
 * The readings, indexed by the corpus's own global word index. Resolves to
 * null if they cannot be had; callers show nothing and carry on.
 *
 * Concurrent callers share one request — the toggle can be flipped twice
 * before the first fetch lands, and two 584 KB downloads for one setting is
 * exactly the cost this module exists to avoid.
 *
 * @param expected how many words the corpus has. The two files carry SEPARATE
 *   content hashes, so a corpus that changed while the readings did not leaves
 *   a browser holding a good `translit.json` for the wrong Quran — and every
 *   reading after the first inserted word would sit under its neighbour. One
 *   count is the whole check, and being wrong here is silent by nature.
 */
export function loadTranslit(expected: number): Promise<string[] | null> {
  if (words) return Promise.resolve(words);
  inFlight ??= fetch(URL_)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<TranslitFile>;
    })
    .then((f) => {
      const parts = f.words.split(f.sep || " ");
      if (parts.length !== expected) throw new Error(`${parts.length} readings for ${expected} words`);
      words = parts;
      return parts;
    })
    .catch((e: unknown) => {
      // Loud in the console, silent on the page: the reciter asked for a
      // reading aid, not for an error to read.
      console.warn(`[prompter] transliteration unavailable: ${String(e)}`);
      inFlight = null; // a later toggle may succeed — a flaky network, say
      return null;
    });
  return inFlight;
}
