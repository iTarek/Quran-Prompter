import { describe, expect, it } from "vitest";
import { ayahText, garble, loadCorpus, loadIndex } from "./helpers.js";

const ISTIADHA = "ءَعُۥۥذُبِللَااهِمِنَششَييطَاانِررَجِۦۦم";

describe("whole-Quran search", () => {
  it("builds in reasonable time", () => {
    const t0 = performance.now();
    loadIndex();
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it("locks 1:1 on the basmala + 1:2, with the replay starting at the basmala", () => {
    const r = loadIndex().search(ayahText(1, 1) + ayahText(1, 2));
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(1);
    expect(r.hits[0].ayah).toBe(1);
    expect(r.hits[0].word).toBe(0);
    expect(r.hits[0].queryStart).toBe(0);
  });

  it("a basmala alone never locks — an Ikhlas reciter is about to continue", () => {
    const r = loadIndex().search(ayahText(1, 1));
    expect(r.decisive).toBe(false);
  });

  it("locks 112:1 after a basmala, not Al-Fatiha", () => {
    const r = loadIndex().search(ayahText(1, 1) + ayahText(112, 1) + ayahText(112, 2));
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(112);
    expect(r.hits[0].ayah).toBe(1);
    expect(r.hits[0].queryStart).toBeGreaterThanOrEqual(ayahText(1, 1).length - 2);
  });

  it("skips an استعاذة head", () => {
    const r = loadIndex().search(ISTIADHA + ayahText(18, 1) + ayahText(18, 2).slice(0, 20));
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(18);
    expect(r.hits[0].ayah).toBe(1);
    expect(r.hits[0].queryStart).toBeGreaterThan(ISTIADHA.length - 4);
  });

  it("the Ar-Rahman refrain alone is not decisive, with its preceding ayah it is", () => {
    const idx = loadIndex();
    const refrain = idx.search(ayahText(55, 13));
    expect(refrain.decisive).toBe(false);
    const withContext = idx.search(ayahText(55, 12) + ayahText(55, 13));
    expect(withContext.decisive).toBe(true);
    expect(withContext.hits[0].surah).toBe(55);
    expect(withContext.hits[0].ayah).toBe(12);
  });

  it("a mid-ayah start locates the right word", () => {
    const c = loadCorpus();
    const first = c.ayahFirstWord(2, 255);
    const text = c.text.slice(c.wordStart[first + 5], c.wordStart[first + 20]);
    const r = loadIndex().search(text);
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(2);
    expect(r.hits[0].ayah).toBe(255);
    expect(r.hits[0].word).toBe(5);
  });

  it("10% garble still locks", () => {
    const r = loadIndex().search(garble(ayahText(36, 1, 4), 0.1, 7));
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(36);
  });

  it("«بسم الله… الحمد لله» locks 1:1 cold — the basmala is the evidence", () => {
    const r = loadIndex().search(ayahText(1, 1) + ayahText(1, 2).slice(0, 14));
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(1);
    expect(r.hits[0].ayah).toBe(1);
    expect(r.hits[0].queryStart).toBe(0);
  });

  it("the Fatiha hint resolves a bare «الحمد لله رب العالمين» — cold it is a tie", () => {
    const idx = loadIndex();
    const q = ayahText(1, 2); // verbatim at 1:2, 6:45, 10:10, 37:182, 39:75, 40:65
    const cold = idx.search(q);
    expect(cold.decisive).toBe(false);
    const hinted = idx.search(q, { surah: 1, ayah: 1 });
    expect(hinted.decisive).toBe(true);
    expect(hinted.hits[0].surah).toBe(1);
    expect(hinted.hits[0].ayah).toBe(2);
  });

  it("a decisively better distant match beats the hint", () => {
    const r = loadIndex().search(ayahText(112, 1, 3), { surah: 2, ayah: 1 });
    expect(r.decisive).toBe(true);
    expect(r.hits[0].surah).toBe(112);
  });

  it("is deterministic", () => {
    const idx = loadIndex();
    const q = garble(ayahText(2, 1, 3), 0.15, 3);
    const a = JSON.stringify(idx.search(q));
    const b = JSON.stringify(idx.search(q));
    expect(a).toBe(b);
  });

  it("searches fast enough to run every chunk", () => {
    const idx = loadIndex();
    const q = ayahText(18, 10, 13).slice(-250);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) idx.search(q);
    expect((performance.now() - t0) / 10).toBeLessThan(100);
  });
});
