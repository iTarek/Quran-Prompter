import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, RecitationEngine, type EngineEvent, type HeardToken } from "../src/core/index.js";
import { ayahText, loadCorpus, loadIndex } from "./helpers.js";

/**
 * Phonemes that are speech but not Quran — the "stopped reciting and started
 * talking" input. Nothing in the corpus matches it, so no relocation can
 * rescue the tracker and the struggle counter is the only way out.
 */
const TALK_ONCE = "وَلِكِنمُشكِلَةهَاذَاالكَلَاامُعَاادِييَه";
const TALK = TALK_ONCE.repeat(6);

/**
 * Words the cursor may walk past before the engine gives up on TALK above.
 * Measured 14; the same feed with the counter disabled walks 26 and would
 * keep walking for as long as the talking lasts. On the real recording the
 * reciter sees no wrong ayah at all — this synthetic stream is denser and
 * faster than speech, with no pause anywhere for the search to breathe.
 */
const WALK_BUDGET = 16;

/**
 * Cursor moves the display gate may still let through once the reciter stops
 * reciting: one `holdWindow` of speech has to arrive before the cost rate can
 * know. Measured 2 on the real recording, 3 on this denser synthetic stream.
 */
const HOLD_BUDGET = 3;

const ISTIADHA = "ءَعُۥۥذُبِللَااهِمِنَششَييطَاانِررَجِۦۦم";

/** Feeds text in 480 ms chunks (~5 chars each, 12 frames), collecting events. */
function recite(engine: RecitationEngine, text: string, startFrame = 0, margin = 1): { events: EngineEvent[]; frame: number } {
  const events: EngineEvent[] = [];
  let frame = startFrame;
  const cs = [...text];
  for (let i = 0; i < cs.length; i += 5) {
    const toks: HeardToken[] = cs.slice(i, i + 5).map((sym, k) => ({ sym, frame: frame + k * 2, margin }));
    frame += 12;
    events.push(...engine.feed(toks, frame));
  }
  return { events, frame };
}

/** Silence: chunks with no tokens. */
function silence(engine: RecitationEngine, seconds: number, startFrame: number): { events: EngineEvent[]; frame: number } {
  const events: EngineEvent[] = [];
  let frame = startFrame;
  for (let s = 0; s < seconds * 25; s += 12) {
    frame += 12;
    events.push(...engine.feed([], frame));
  }
  return { events, frame };
}

function types(events: EngineEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("recitation engine", () => {
  // The words the search guesses before it is sure — what the prompter floats
  // up behind its listening orb. A refrain is the honest test: «فَبِأَيِّ آلَاءِ
  // رَبِّكُمَا تُكَذِّبَانِ» is 31 identical ayahs, so the search cannot lock on it
  // alone, and the guess is all there is to show.
  it("says what it is guessing while it cannot lock, and stops once it has", () => {
    const corpus = loadCorpus();
    const engine = new RecitationEngine(corpus, loadIndex(), DEFAULT_CONFIG);
    engine.startSearch();
    const refrain = recite(engine, ayahText(55, 13));
    expect(types(refrain.events)).not.toContain("located");
    const guesses = refrain.events.filter((e): e is EngineEvent & { type: "hearing" } => e.type === "hearing");
    expect(guesses.length).toBeGreaterThan(0);
    for (const g of guesses) {
      expect(g.words.length).toBeGreaterThan(0);
      // A guess is one stretch of the mushaf: consecutive words.
      g.words.forEach((w, i) => i > 0 && expect(w).toBe(g.words[i - 1] + 1));
    }
    // An unchanged guess is not sent twice in a row.
    guesses.forEach((g, i) => i > 0 && expect(g.words.join()).not.toBe(guesses[i - 1].words.join()));

    // The ayahs after the refrain are Ar-Rahman's alone: it locks, and from
    // then on there is nothing left to guess.
    const rest = recite(engine, ayahText(55, 14, 16), refrain.frame);
    const at = rest.events.findIndex((e) => e.type === "located");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(types(rest.events.slice(at))).not.toContain("hearing");
  });

  it("still locates after a minute of sound that never locked", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    // The heard buffer is capped. Measuring "how much is new" by its length
    // reads zero once it saturates, which used to stop the search firing for
    // the rest of the session: mic open, nothing ever locking again.
    const { frame } = recite(engine, "ااااببببتتتتثثثث".repeat(80));
    expect(engine.heardText.length).toBe(1000);
    const { events } = recite(engine, ayahText(112, 1, 4), frame);
    expect(events.find((e) => e.type === "located")).toMatchObject({ surah: 112 });
  });

  it("keeps its timers after the decoder's frame clock restarts", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    const noise = "ااااببببتتتتثثثث".repeat(25);
    engine.startSearch();
    expect(types(recite(engine, noise).events)).toContain("locateFailed");
    // A host that resets the decoder alongside startSearch replays frame 0.
    // Baselines holding the old clock make every delta negative, and the
    // 15 s "still searching" signal used to go silent for the whole session.
    engine.startSearch();
    expect(types(recite(engine, noise).events)).toContain("locateFailed");
  });

  it("locates Al-Ikhlas after a basmala, replays it, and completes the surah", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { events, frame } = recite(engine, ISTIADHA + ayahText(1, 1) + ayahText(112, 1, 4));
    const located = events.find((e) => e.type === "located");
    expect(located).toMatchObject({ surah: 112, ayah: 1, word: 0 });
    expect(engine.state).toBe("tracking");
    const after = silence(engine, 1, frame);
    const all = [...events, ...after.events];
    const verdicts = all.filter((e) => e.type === "verdicts").flatMap((e) => (e.type === "verdicts" ? e.changes : []));
    const final = new Map<number, string>();
    for (const v of verdicts) final.set(v.wordIndex, v.state);
    const c = loadCorpus();
    const first = c.ayahFirstWord(112, 1);
    for (let w = first; w < c.surah(112).endWord; w++) expect(final.get(w)).toBe("ok");
    expect(types(all)).toContain("completed");
  });

  it("says locateFailed after 15 s of noise and keeps listening", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const noise = "بَتَكَسَ".repeat(40);
    const { events, frame } = recite(engine, noise);
    expect(types(events)).toContain("locateFailed");
    expect(engine.state).toBe("searching");
    const then = recite(engine, ayahText(114, 1, 3), frame);
    expect(then.events.find((e) => e.type === "located")).toMatchObject({ surah: 114 });
  });

  it("goes idle after 8 s without progress while tracking", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { frame } = recite(engine, ayahText(18, 1, 2));
    expect(engine.state).toBe("tracking");
    const quiet = silence(engine, 10, frame);
    expect(quiet.events.find((e) => e.type === "idle")).toMatchObject({ reason: "silent" });
  });

  it("shows nothing new while what it hears is not the loaded text", () => {
    // THE BUG THIS EXISTS FOR (Tarek, 2026-09-05, on a test recording):
    // 18:1 recited, then ordinary Arabic speech — «كلام خارج القرآن الكريم».
    // The page walked ELEVEN words of 18:2 that were never recited, five of
    // them after `lost` had already fired, because the alignment table always
    // has a cheapest cell and nothing ever said "nowhere". With the hold: two,
    // the length of one window of bad audio.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { frame } = recite(engine, ayahText(18, 1));
    const shown = engine.tracker!.cursor.wordIndex;
    const talk = recite(engine, TALK, frame);
    const moves = talk.events.filter((e) => e.type === "cursor");
    expect(moves.length).toBeLessThanOrEqual(HOLD_BUDGET);
    // The words it did show are the ones heard before the gate could know;
    // nothing is shown from deeper in the surah than that.
    for (const m of moves) expect(m.wordIndex - shown).toBeLessThanOrEqual(HOLD_BUDGET);
    // Feeding the SAME talk with the gate disabled is what the reciter used to
    // get — the test is worth nothing unless it fails without the gate.
    const loose = new RecitationEngine(loadCorpus(), loadIndex(), { ...DEFAULT_CONFIG, holdRate: Number.POSITIVE_INFINITY });
    loose.startSearch();
    const f2 = recite(loose, ayahText(18, 1)).frame;
    const walked = recite(loose, TALK, f2).events.filter((e) => e.type === "cursor").length;
    expect(walked).toBeGreaterThan(moves.length);
  });

  it("holds only for speech, never for a reciter who skips ahead", () => {
    // A skip is the worst LEGITIMATE cost spike there is — measured to 0.40
    // over the hold window, against 0.45 for the gate and 0.41+ for talk. A
    // reciter who jumps forward must still be followed, instantly.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { frame } = recite(engine, ayahText(55, 1, 8));
    expect(engine.tracker?.range.surah).toBe(55);
    const after = recite(engine, ayahText(55, 30, 34), frame);
    const moved = after.events.filter((e) => e.type === "cursor").at(-1);
    expect(moved?.ayah).toBeGreaterThanOrEqual(30);
  });

  it("ends the run when the reciter stops reciting and just talks", () => {
    // FIELD REPORT 36 (Tarek, 2026-09-03), first on iOS and reproduced here
    // on a test recording: 18:1-18:2 recited, then ordinary
    // speech. Silence would have ended the run; TALK does not, because the
    // garbage keeps the cursor moving and so keeps resetting the 8 s
    // no-progress timer. The engine emitted `lost` and walked on through
    // 18:3, 18:4, back to 18:3, then 18:5 — text nobody was reciting.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { frame } = recite(engine, ayahText(18, 1, 2));
    expect(engine.state).toBe("tracking");
    const at = engine.tracker!.cursor.wordIndex;
    const talk = recite(engine, TALK, frame);
    const gaveUp = talk.events.findIndex((e) => e.type === "idle");
    expect(gaveUp).toBeGreaterThanOrEqual(0);
    expect(talk.events[gaveUp]).toMatchObject({ reason: "lost" });
    // What the reciter would have watched walk past before it gave up. The
    // engine only emits; the host is what stops the run, so measure up to the
    // event, not to the end of the feed.
    const walked = talk.events.slice(0, gaveUp).filter((e) => e.type === "cursor");
    expect((walked.at(-1)?.wordIndex ?? at) - at).toBeLessThanOrEqual(WALK_BUDGET);
  });

  it("calls a reciter who goes quiet silent, never lost", () => {
    // `costRate` averages over the last heard characters, so SILENCE does not
    // move it: a reciter who has a rough patch and then simply stops stays
    // `lost` with no new evidence. Counting those checks ended the run as
    // `lost` after 4.5 s of quiet — the wrong reason, 3.5 s early, and again
    // every 4.5 s for as long as the quiet lasted. Only checks that heard
    // something may count.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    let { frame } = recite(engine, ayahText(18, 1, 2));
    for (let i = 0; i < 40 && !engine.tracker?.lost; i++) frame = recite(engine, TALK_ONCE, frame).frame;
    expect(engine.tracker?.lost).toBe(true);
    // Now the reciter stops dead. Ten seconds of nothing at all.
    const quiet = silence(engine, 10, frame);
    const idles = quiet.events.filter((e) => e.type === "idle");
    expect(idles).toHaveLength(1);
    expect(idles[0]).toMatchObject({ reason: "silent" });
  });

  it("never ends the run on a reciter it can still follow", () => {
    // The counter resets on any check that finds the tracker matching, so a
    // long correct recitation — including the surah's own repeated ayahs —
    // never approaches the limit. Measured on the real model too: Ar-Rahman
    // (17 min) and Al-Mursalat (7 min) produce no `idle (lost)` at all.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { events } = recite(engine, ayahText(55, 1, 30));
    const idles = events.filter((e) => e.type === "idle");
    expect(idles).toEqual([]);
    expect(engine.tracker?.range.surah).toBe(55);
  });

  it("stays on the surah when told to, but still reports silence", () => {
    // The reading mode: locate once, then never leave. Relocation and the
    // give-up both stop — but `idle (silent)` must NOT, because it is the
    // honest "nothing is arriving" signal and the host decides what it means.
    // An earlier version returned early here and swallowed it.
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    engine.setStayOnSurah(true);
    const { frame } = recite(engine, ayahText(113, 1, 3));
    expect(engine.tracker?.range.surah).toBe(113);
    // A different surah entirely: without staying this relocates (next test).
    const moved = recite(engine, ayahText(114, 1, 6), frame);
    expect(types(moved.events)).not.toContain("relocated");
    expect(types(moved.events)).not.toContain("idle");
    expect(engine.tracker?.range.surah).toBe(113);
    const quiet = silence(engine, 10, moved.frame);
    expect(quiet.events.find((e) => e.type === "idle")).toMatchObject({ reason: "silent" });
  });

  it("relocates when the reciter has moved to another surah", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.startSearch();
    const { frame } = recite(engine, ayahText(113, 1, 3));
    expect(engine.tracker?.range.surah).toBe(113);
    const moved = recite(engine, ayahText(114, 1, 6), frame);
    expect(types(moved.events)).toContain("lost");
    const rel = moved.events.find((e) => e.type === "relocated");
    expect(rel).toMatchObject({ to: { surah: 114 } });
    expect(engine.tracker?.range.surah).toBe(114);
  });

  it("the Fatiha hint locks 1:2 from a bare الحمد", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.setHint({ surah: 1, ayah: 1 });
    engine.startSearch();
    const { events } = recite(engine, ayahText(1, 2) + ayahText(1, 3));
    expect(events.find((e) => e.type === "located")).toMatchObject({ surah: 1, ayah: 2 });
  });

  it("track() loads a known position and emits the cursor as words arrive", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.track(2, 255);
    const { events } = recite(engine, ayahText(2, 255).slice(0, 60));
    const cursors = events.filter((e) => e.type === "cursor");
    expect(cursors.length).toBeGreaterThan(3);
    expect(cursors[0]).toMatchObject({ surah: 2, ayah: 255 });
  });
});
