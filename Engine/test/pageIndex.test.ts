import { describe, expect, it } from "vitest";
import { PageIndex } from "../src/core/pageIndex.js";
import { AYAHS_PER_PAGE } from "../src/model/pages.js";
import { loadCorpus } from "./helpers.js";

describe("mushaf pages", () => {
  it("covers every ayah with pages 1..604", () => {
    const idx = new PageIndex();
    expect(AYAHS_PER_PAGE).toHaveLength(604);
    expect(idx.ayahCount).toBe(6236);
    expect(idx.page(0)).toBe(1);
    expect(idx.page(6235)).toBe(604);
    // Never goes backwards: the band is drawn on a page CHANGE, so a table
    // that dipped would draw one in the middle of a page.
    let prev = 0;
    for (let i = 0; i < idx.ayahCount; i++) {
      const p = idx.page(i)!;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("agrees with the corpus on how many ayahs there are", () => {
    // A page table built for a different corpus would silently shift every
    // band in the second half of the mushaf.
    const corpus = loadCorpus();
    let total = 0;
    for (let s = 1; s <= 114; s++) total += corpus.ayahCount(s);
    expect(new PageIndex().ayahCount).toBe(total);
  });

  it("puts known page turns where the mushaf does", () => {
    const corpus = loadCorpus();
    const idx = new PageIndex();
    const pageOf = (s: number, a: number) => idx.page(corpus.ayahOrdinal(s, a));
    expect(pageOf(1, 7)).toBe(1); // Al-Fatiha is page 1, whole
    expect(pageOf(2, 1)).toBe(2); // Al-Baqara opens page 2
    expect(pageOf(114, 6)).toBe(604); // An-Nas closes the mushaf
  });

  it("returns null outside the corpus rather than throwing", () => {
    const idx = new PageIndex();
    expect(idx.page(-1)).toBeNull();
    expect(idx.page(6236)).toBeNull();
  });
});

describe("hasAyah", () => {
  // Guards a saved position out of a browser's storage. Before it existed, an
  // ayah past the end of its surah reached `wordIndex`, threw inside the
  // host's start, and left the session begun with nothing on screen and no
  // button — recoverable only by reloading.
  it("accepts what the corpus has and refuses everything else", () => {
    const c = loadCorpus();
    expect(c.hasAyah(1, 1)).toBe(true);
    expect(c.hasAyah(1, 7)).toBe(true);
    expect(c.hasAyah(114, 6)).toBe(true);
    expect(c.hasAyah(2, 286)).toBe(true);
    expect(c.hasAyah(1, 8)).toBe(false); // Al-Fatiha has seven
    expect(c.hasAyah(18, 9999)).toBe(false);
    expect(c.hasAyah(0, 1)).toBe(false);
    expect(c.hasAyah(115, 1)).toBe(false);
    expect(c.hasAyah(1, 0)).toBe(false);
    expect(c.hasAyah(1.5, 1)).toBe(false);
    expect(c.hasAyah(NaN, NaN)).toBe(false);
  });

  it("does not throw on an unknown surah, unlike ayahCount", () => {
    const c = loadCorpus();
    expect(() => c.ayahCount(999)).toThrow();
    expect(c.hasAyah(999, 1)).toBe(false);
  });
});
