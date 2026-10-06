import { describe, expect, it } from "vitest";
import { RecitationEngine } from "../src/core/engine.js";
import { Tracker } from "../src/core/tracker.js";
import { DEFAULT_CONFIG, type EngineEvent } from "../src/core/types.js";
import { ayahText, chars, garble, loadCorpus, loadIndex, tokens } from "./helpers.js";

/**
 * المتشابهات — the repeated and near-identical ayahs.
 *
 * 788 of the Quran's ayahs have another ayah within 0.15 of their text, 623 of
 * them in a different surah (measured 2026-09-04 with the engine's own index).
 * A reciter on one of them is the case where an aligner is most tempted to show
 * the wrong occurrence, so every rule here is about NOT moving: the cursor must
 * stay where the reciter is, and the search must refuse to guess between
 * identical texts rather than pick one.
 *
 * Verified the same day against real audio through the real model (Ar-Rahman
 * 78 ayahs / 31 refrains, Al-Mursalat 50 / 10, Al-Kafirun on a phone mic):
 * zero teleports.
 */

/** Surahs built out of refrains — the whole surah recited in order. */
const REFRAIN_SURAHS = [
  { surah: 55, name: "Ar-Rahman", refrains: 31 },
  { surah: 77, name: "Al-Mursalat", refrains: 10 },
  { surah: 54, name: "Al-Qamar", refrains: 4 },
  { surah: 26, name: "Ash-Shu'ara", refrains: 8 },
];

/** Ayahs whose text also exists elsewhere, at the distance the index reports. */
const TWINS = [
  { surah: 41, ayah: 45, twins: "11:110" },
  { surah: 11, ayah: 110, twins: "41:45" },
  { surah: 36, ayah: 48, twins: "10:48 21:38 27:71 34:29 67:25" },
  { surah: 67, ayah: 25, twins: "the same six" },
  { surah: 5, ayah: 86, twins: "5:10 57:19" },
  { surah: 26, ayah: 127, twins: "five inside Ash-Shu'ara" },
  { surah: 20, ayah: 116, twins: "2:34" },
  { surah: 7, ayah: 160, twins: "2:57" },
  { surah: 3, ayah: 84, twins: "2:136" },
  { surah: 55, ayah: 16, twins: "the other 30 refrains" },
];

function feed(engine: RecitationEngine, text: string, startFrame: number): { events: EngineEvent[]; endFrame: number } {
  const events: EngineEvent[] = [];
  const t = tokens(text, startFrame);
  for (let i = 0; i < t.length; i += 20) {
    const slice = t.slice(i, i + 20);
    events.push(...engine.feed(slice, slice[slice.length - 1].frame));
  }
  return { events, endFrame: startFrame + Math.ceil(text.length * 2.5) };
}

describe("المتشابهات", () => {
  it.each(REFRAIN_SURAHS)("$name: reciting all of it lands on every ayah in turn ($refrains refrains)", ({ surah }) => {
    const c = loadCorpus();
    const count = c.surah(surah).ayahCount;
    // 12% of letters replaced — this model garbles at least that much.
    for (const fraction of [0, 0.12]) {
      const tracker = new Tracker(c, { surah, fromAyah: 1, toAyah: count }, c.ayahFirstWord(surah, 1), DEFAULT_CONFIG);
      let frame = 0;
      const wrong: string[] = [];
      for (let a = 1; a <= count; a++) {
        const text = fraction > 0 ? garble(ayahText(surah, a), fraction, 7 + a) : ayahText(surah, a);
        tracker.feed(chars(text, frame));
        frame += Math.ceil(text.length * 2.5) + 10;
        if (tracker.cursor.ayah !== a) wrong.push(`${a}→${tracker.cursor.ayah}`);
      }
      expect(wrong, `garble ${fraction}`).toEqual([]);
    }
  });

  it.each(TWINS)("$surah:$ayah is not confused with $twins when it is recited in place", ({ surah, ayah }) => {
    const c = loadCorpus();
    const engine = new RecitationEngine(c, loadIndex(), DEFAULT_CONFIG);
    const last = c.surah(surah).ayahCount;
    const from = Math.max(1, ayah - 2);
    const to = Math.min(last, ayah + 2);
    engine.track(surah, from, 0);
    let frame = 0;
    const moves: EngineEvent[] = [];
    for (let a = from; a <= to; a++) {
      for (const fraction of [0.12]) {
        const r = feed(engine, garble(ayahText(surah, a), fraction, 11 + a), frame);
        frame = r.endFrame + 5;
        moves.push(...r.events.filter((e) => e.type === "relocated"));
      }
    }
    // Never leaves the surah, and ends on the ayah actually being recited.
    expect(moves).toEqual([]);
    expect(engine.tracker!.cursor.surah).toBe(surah);
    expect(engine.tracker!.cursor.ayah).toBe(to);
  });

  it.each(TWINS)("starting cold ON $surah:$ayah never locks onto the wrong copy", ({ surah, ayah }) => {
    const c = loadCorpus();
    const engine = new RecitationEngine(c, loadIndex(), DEFAULT_CONFIG);
    engine.startSearch();
    const last = c.surah(surah).ayahCount;
    const to = Math.min(last, ayah + 2);
    const a = feed(engine, ayahText(surah, ayah), 0);
    // On identical text the search must NOT pick one: it stays searching, or
    // it has enough context to be right. A wrong lock is the failure.
    const located = a.events.filter((e): e is Extract<EngineEvent, { type: "located" }> => e.type === "located");
    for (const e of located) expect(`${e.surah}:${e.ayah}`).toBe(`${surah}:${ayah}`);
    // Once the reciter carries on, the continuation resolves it.
    feed(engine, ayahText(surah, ayah + 1, to), a.endFrame + 5);
    expect(engine.tracker?.cursor.surah).toBe(surah);
  });

  it("follows a reciter who skips from one refrain to a later one", () => {
    const c = loadCorpus();
    const engine = new RecitationEngine(c, loadIndex(), DEFAULT_CONFIG);
    engine.track(55, 40, 0); // 55:40 is a refrain
    let frame = 0;
    for (const a of [40, 41, 42]) frame = feed(engine, ayahText(55, a), frame).endFrame + 5;
    expect(engine.tracker!.cursor.ayah).toBe(42);
    // …then jumps to 55:60, twenty ayahs and ten refrains later.
    for (const a of [60, 61]) frame = feed(engine, ayahText(55, a), frame).endFrame + 5;
    expect(engine.tracker!.cursor.ayah).toBe(61);
  });
});
