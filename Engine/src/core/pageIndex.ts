import { AYAHS_PER_PAGE } from "../model/pages.js";

/**
 * Which mushaf page each ayah ENDS on, and therefore where the printed page
 * turns. 604 pages of the Madani mushaf, rebuilt from the run-length table in
 * `model/pages.ts`, generated from the AlKetab app's mushaf data.
 *
 * **The ayah it names is the LAST one on the page**, which is what a page band
 * needs: the band is drawn after an ayah whose page differs from the next
 * ayah's, and it carries the page that just ended.
 */
export class PageIndex {
  /** Page of the ayah at each global ordinal, 0-based across all 6,236. */
  private readonly byOrdinal: Uint16Array;

  constructor() {
    const total = AYAHS_PER_PAGE.reduce((a, b) => a + b, 0);
    this.byOrdinal = new Uint16Array(total);
    let at = 0;
    for (let p = 0; p < AYAHS_PER_PAGE.length; p++) {
      for (let i = 0; i < AYAHS_PER_PAGE[p]; i++) this.byOrdinal[at++] = p + 1;
    }
  }

  get ayahCount(): number {
    return this.byOrdinal.length;
  }

  /**
   * The page an ayah ends on, by its global ordinal (0-based). Out of range
   * returns null rather than throwing: a page band is furniture, and a corpus
   * that ever disagreed with this table must lose a band, not the surah.
   */
  page(ordinal: number): number | null {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= this.byOrdinal.length) return null;
    return this.byOrdinal[ordinal];
  }
}
