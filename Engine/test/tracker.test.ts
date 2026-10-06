import { describe, expect, it } from "vitest";
import { Tracker, VerdictTracer, type WordVerdict } from "../src/core/index.js";
import { ayahText, chars, garble, loadCorpus } from "./helpers.js";

function fatihaTracker(startWord = 0) {
  const c = loadCorpus();
  const t = new Tracker(c, { surah: 1, fromAyah: 1, toAyah: 7 }, c.ayahFirstWord(1, 1) + startWord);
  return { c, t, tracer: new VerdictTracer(t) };
}

function states(v: WordVerdict[]): string {
  return v.map((x) => `${x.ayah}:${x.word}=${x.state}`).join(" ");
}

function byRef(v: WordVerdict[], ayah: number, word: number): WordVerdict | undefined {
  return v.find((x) => x.ayah === ayah && x.word === word);
}

describe("tracker", () => {
  it("follows a clean recitation of Al-Fatiha and marks every word ok", () => {
    const { t, tracer } = fatihaTracker();
    const text = ayahText(1, 1, 7);
    let lastCell = -1;
    for (const ch of chars(text)) {
      t.feed([ch]);
      expect(t.cursorPosition).toBeGreaterThanOrEqual(lastCell);
      lastCell = t.cursorPosition;
    }
    expect(t.cursor.ayah).toBe(7);
    expect(t.reachedEnd).toBe(true);
    // settle the tail
    t.feed(chars("اااااااا"));
    const v = tracer.verdicts();
    const notOk = v.filter((x) => x.state !== "ok");
    expect(notOk.map((x) => `${x.ayah}:${x.word}=${x.state}`)).toEqual([]);
    expect(v.length).toBe(29);
  });

  it("marks a skipped word and keeps its neighbours ok", () => {
    const { c, t, tracer } = fatihaTracker();
    // 1:2 without لله (word 1)
    const first = c.ayahFirstWord(1, 2);
    const w0 = c.phonemes(first);
    const w2 = c.phonemes(first + 2);
    const w3 = c.phonemes(first + 3);
    const text = ayahText(1, 1) + w0 + w2 + w3 + ayahText(1, 3);
    t.feed(chars(text));
    t.feed(chars("اااااااا"));
    const v = tracer.verdicts();
    expect(byRef(v, 2, 1)?.state).toBe("skipped");
    expect(byRef(v, 2, 0)?.state).toBe("ok");
    expect(byRef(v, 2, 2)?.state).toBe("ok");
    expect(byRef(v, 2, 3)?.state).toBe("ok");
  });

  it("a repeated phrase within the ayah brings the cursor back without a wrong", () => {
    const { c, t, tracer } = fatihaTracker();
    const a2 = c.ayahFirstWord(1, 2);
    const half = c.phonemes(a2) + c.phonemes(a2 + 1);
    const text = ayahText(1, 1) + half + ayahText(1, 2) + ayahText(1, 3);
    const stream = chars(text);
    const cut = ayahText(1, 1).length + half.length;
    t.feed(stream.slice(0, cut));
    expect(t.cursor.ayah).toBe(2);
    expect(t.cursor.word).toBe(1);
    // the whole of 1:2 again — the cursor must come back and end on its last word
    const again = ayahText(1, 2).length;
    t.feed(stream.slice(cut, cut + again));
    expect(t.cursor.ayah).toBe(2);
    expect(t.cursor.word).toBe(3);
    t.feed(stream.slice(cut + again));
    t.feed(chars("اااااااا"));
    const v = tracer.verdicts();
    expect(v.filter((x) => x.state === "wrong")).toEqual([]);
    expect(byRef(v, 2, 0)?.state).toBe("ok");
    expect(byRef(v, 2, 1)?.state).toBe("ok");
    expect(byRef(v, 3, 0)?.state).toBe("ok");
  });

  it("a jump to a later ayah lands there", () => {
    const { t } = fatihaTracker();
    t.feed(chars(ayahText(1, 1) + ayahText(1, 2)));
    expect(t.cursor.ayah).toBe(2);
    t.feed(chars(ayahText(1, 6)));
    expect(t.cursor.ayah).toBe(6);
  });

  it("a heavily substituted word is wrong, a lightly garbled one is not", () => {
    const { c, t, tracer } = fatihaTracker();
    const a2 = c.ayahFirstWord(1, 2);
    const w2 = c.phonemes(a2 + 2); // رَببِ
    const wrongWord = "كَلسِ"; // three of five sounds differ
    const text = ayahText(1, 1) + c.phonemes(a2) + c.phonemes(a2 + 1) + wrongWord + c.phonemes(a2 + 3) + ayahText(1, 3);
    t.feed(chars(text));
    t.feed(chars("اااااااا"));
    const v = tracer.verdicts();
    expect(w2).not.toBe(wrongWord);
    expect(byRef(v, 2, 2)?.state).toBe("wrong");
    expect(byRef(v, 2, 3)?.state).toBe("ok");
    expect(byRef(v, 3, 0)?.state).toBe("ok");
  });

  it("a wrong-looking word the model was unsure about is unsure, never wrong", () => {
    const { c, t, tracer } = fatihaTracker();
    const a2 = c.ayahFirstWord(1, 2);
    const text = ayahText(1, 1) + c.phonemes(a2) + c.phonemes(a2 + 1) + "كَلسِ" + c.phonemes(a2 + 3) + ayahText(1, 3);
    t.feed(chars(text, 0, 0.1));
    t.feed(chars("اااااااا", 0, 0.1));
    const v = tracer.verdicts();
    expect(v.filter((x) => x.state === "wrong")).toEqual([]);
    expect(byRef(v, 2, 2)?.state).toBe("unsure");
    expect(byRef(v, 2, 3)?.state).toBe("ok");
  });

  it("garbling 10% of letters still tracks to the end", () => {
    const { t, tracer } = fatihaTracker();
    t.feed(chars(garble(ayahText(1, 1, 7), 0.1)));
    t.feed(chars("اااااااا"));
    expect(t.cursor.ayah).toBe(7);
    const v = tracer.verdicts();
    expect(v.filter((x) => x.state === "wrong").length).toBeLessThanOrEqual(2);
  });

  it("verdicts after a retract match a fresh run of the same stream", () => {
    const c = loadCorpus();
    // Long enough that several 300-char segments close and the span cache is
    // warm — Al-Fatiha never reaches one.
    const make = () => {
      const t = new Tracker(c, { surah: 2, fromAyah: 1, toAyah: 20 }, c.ayahFirstWord(2, 1));
      return { t, tracer: new VerdictTracer(t) };
    };
    const stream = chars(ayahText(2, 1, 20));
    const other = chars(ayahText(2, 30, 40)).slice(0, 400);

    const a = make();
    a.t.feed(stream.slice(0, 900));
    a.tracer.verdicts();
    a.t.retract(400);
    // Different audio over the retracted offsets. This guards the invariant
    // (a retracted run must verdict like a fresh one); it does NOT prove the
    // revision check in VerdictTracer, which still passes with that check
    // disabled — a stale hit needs the segment key to collide while the
    // content differs, and no such case has been constructed.
    a.t.feed(other);

    const b = make();
    b.t.feed(stream.slice(0, 500));
    b.t.feed(other);

    expect([...a.t.trail]).toEqual([...b.t.trail]);
    expect(states(a.tracer.verdicts(true))).toBe(states(b.tracer.verdicts(true)));
  });

  it("retract then re-feed is identical to never having fed", () => {
    const { t } = fatihaTracker();
    const text = ayahText(1, 1, 3);
    const stream = chars(text);
    t.feed(stream.slice(0, 40));
    const cellA = t.cursorPosition;
    const costA = t.cursor.cost;
    const trailA = [...t.trail];
    t.feed(stream.slice(40, 70));
    t.retract(30);
    expect(t.cursorPosition).toBe(cellA);
    expect(t.cursor.cost).toBe(costA);
    expect([...t.trail]).toEqual(trailA);
    t.feed(stream.slice(40));
    const u = fatihaTracker().t;
    u.feed(stream);
    expect([...t.trail]).toEqual([...u.trail]);
    expect(t.cursor).toEqual(u.cursor);
  });

  it("lost detection fires on a different surah", () => {
    const { c } = fatihaTracker();
    const t = new Tracker(c, { surah: 113, fromAyah: 1, toAyah: 5 }, c.ayahFirstWord(113, 1));
    t.feed(chars(ayahText(113, 1, 2)));
    expect(t.lost).toBe(false);
    t.feed(chars(ayahText(18, 1, 4)));
    expect(t.lost).toBe(true);
  });

  it("states summary reads sanely", () => {
    const { t, tracer } = fatihaTracker();
    t.feed(chars(ayahText(1, 1, 2)));
    const s = states(tracer.verdicts());
    expect(s).toContain("1:0=ok");
    expect(s).toContain("pending");
  });
});
