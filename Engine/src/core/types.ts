/** A surah + ayah pair (1-based, as printed in the mushaf). */
export interface AyahRef {
  surah: number;
  ayah: number;
}

/** A word inside an ayah; `word` is 0-based within the ayah. */
export interface WordRef extends AyahRef {
  word: number;
}

/** One phoneme character as heard, with the model output frame it landed on
 *  (0.04 s per frame) and the decoder's confidence margin for its token. */
export interface HeardChar {
  ch: string;
  frame: number;
  margin: number;
}

/** One decoded model token — may expand to several phoneme characters. */
export interface HeardToken {
  sym: string;
  frame: number;
  margin: number;
}

/** The stretch of Quran a tracker aligns against. */
export interface LoadRange {
  surah: number;
  fromAyah: number;
  toAyah: number;
}

export type WordState = "pending" | "ok" | "unsure" | "wrong" | "skipped";

export interface WordVerdict {
  /** Global word index in the corpus (stable across surah reloads). */
  wordIndex: number;
  surah: number;
  ayah: number;
  word: number;
  state: WordState;
  /** Normalised alignment distance (0 = identical). 1 for skipped. */
  distance: number;
  /** Heard phoneme count / expected phoneme count. */
  heardRatio: number;
  /** Mean decoder margin over the heard chars assigned to this word. */
  margin: number;
}

export interface Cursor {
  /** Global word index the cursor sits on, or -1 before anything matched. */
  wordIndex: number;
  surah: number;
  ayah: number;
  word: number;
  /** Cost of the best alignment so far (the argmin cell's value). */
  cost: number;
}

export interface SearchHit extends WordRef {
  /** Global word index. */
  wordIndex: number;
  /** Char offset in the corpus phoneme text where the match starts. */
  refOffset: number;
  /** Char offset (exclusive) where the match ends. */
  refEnd: number;
  /** How many leading query chars the match skipped (garbage head). */
  queryStart: number;
  /** Cost / aligned query length. 0 = perfect. */
  distance: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Best hit clears the distance bar and beats the runner-up by the margin. */
  decisive: boolean;
}

export interface EngineConfig {
  // tracker
  jumpCost: number;
  repeatCost: number;
  commitDwell: number;
  okDistance: number;
  unsureDistance: number;
  minHeardFraction: number;
  minMargin: number;
  lostWindow: number;
  lostRate: number;
  /** Heard chars the display gate averages cost over — short, so it reacts within a second. */
  holdWindow: number;
  /**
   * Cost per heard char over `holdWindow`, at or above which the engine shows
   * NOTHING NEW: no cursor move, no colour. What is being said does not belong
   * to this text, so the page holds where it is.
   */
  holdRate: number;
  // search
  searchMinChars: number;
  searchQueryChars: number;
  searchDecisiveDistance: number;
  searchDecisiveMargin: number;
  // engine timers, in model output frames (25 per second)
  searchEveryFrames: number;
  searchEveryChars: number;
  locateFailedFrames: number;
  relocateEveryFrames: number;
  /** Chars of recent speech a relocation search looks at — recent, so a surah change is visible. */
  relocateQueryChars: number;
  relocateMaxDistance: number;
  relocateRateMargin: number;
  idleFrames: number;
  /** Relocate checks in a row finding the tracker lost with nowhere to go, after which the run ends. */
  maxStruggles: number;
  /** Silence (in frames) after which the tail of the heard stream is judged as final. */
  settleFrames: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  jumpCost: 12,
  repeatCost: 10,
  commitDwell: 6,
  okDistance: 0.15,
  unsureDistance: 0.4,
  minHeardFraction: 0.34,
  minMargin: 0.35,
  lostWindow: 120,
  lostRate: 0.35,
  holdWindow: 30,
  holdRate: 0.45,
  searchMinChars: 12,
  searchQueryChars: 250,
  searchDecisiveDistance: 0.35,
  searchDecisiveMargin: 0.1,
  searchEveryFrames: 25,
  searchEveryChars: 12,
  locateFailedFrames: 375,
  relocateEveryFrames: 37,
  relocateQueryChars: 100,
  relocateMaxDistance: 0.3,
  relocateRateMargin: 0.12,
  idleFrames: 200,
  maxStruggles: 3,
  settleFrames: 25,
};

export type EngineEvent =
  | { type: "located"; surah: number; ayah: number; word: number; replayed: number }
  | { type: "cursor"; surah: number; ayah: number; word: number; wordIndex: number }
  | { type: "verdicts"; changes: WordVerdict[] }
  | { type: "relocated"; from: AyahRef; to: WordRef }
  | { type: "lost" }
  | { type: "locateFailed" }
  /**
   * Still searching, and not sure yet: the words the search's best guess
   * spans, as global word indices, sent only when the guess changes. The
   * engine thinking, made visible — a host may show it (the prompter floats
   * the words up behind its listening orb), but it is a guess, never a
   * verdict, and nothing in the engine is decided from it.
   */
  | { type: "hearing"; words: number[] }
  /**
   * This run is over; the host should search again. `silent` is the reciter
   * stopping; `lost` is `maxStruggles` consecutive checks where the loaded
   * surah no longer explains what is being heard — someone who stopped
   * reciting and started talking.
   */
  | { type: "idle"; reason: "silent" | "lost" }
  | { type: "completed"; surah: number };
