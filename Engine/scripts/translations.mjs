/**
 * The checks behind `fetch-translations.mjs`, kept apart from the network so
 * a test can feed them a QuranEnc response that is short by one ayah and watch
 * them refuse (Engine/test/translations.test.ts).
 *
 * QuranEnc's terms are that the text is never modified, added to or cut. So
 * nothing here edits a translation or a footnote — not even a trim. It only
 * decides whether a download is COMPLETE, and a meaning under the wrong ayah,
 * or an ayah with none, is not a smaller version of right.
 */

/** Every ayah in the Quran — what a translation must cover before it is written. */
export const AYAH_TOTAL = 6236;

/**
 * The translator's name from a QuranEnc title, in whatever language the list
 * was asked for: "English Translation - Noor International Center" →
 * "Noor International Center", «الترجمة الفرنسية - رشيد معاش» → «رشيد معاش».
 * A title with no dash is returned whole rather than guessed at.
 *
 * @param {string} title
 */
export function translatorOf(title) {
  const at = title.lastIndexOf(" - ");
  return at < 0 ? title.trim() : title.slice(at + 3).trim();
}

/**
 * One surah's rows, checked against the corpus: every ayah from 1 to `count`,
 * once each, in order, each with a translation that says something.
 *
 * @param {number} surah
 * @param {number} count how many ayahs the corpus has in this surah
 * @param {unknown} body the API's JSON for `/translation/sura/{key}/{surah}`
 * @returns {[string, { t: string, f?: string }][]}
 */
export function surahEntries(surah, count, body) {
  const rows = /** @type {{ result?: unknown }} */ (body)?.result;
  if (!Array.isArray(rows)) throw new Error(`surah ${surah}: no result array`);
  if (rows.length !== count) throw new Error(`surah ${surah}: ${rows.length} ayahs, the corpus has ${count}`);
  return rows.map((row, i) => {
    const s = Number(row?.sura);
    const a = Number(row?.aya);
    if (s !== surah || a !== i + 1) throw new Error(`surah ${surah}: row ${i + 1} is ${row?.sura}:${row?.aya}`);
    const t = row.translation;
    if (typeof t !== "string" || !t.trim()) throw new Error(`${s}:${a} has no translation`);
    const f = row.footnotes;
    if (f !== undefined && f !== null && typeof f !== "string") throw new Error(`${s}:${a}: footnotes is not text`);
    // Verbatim. An empty footnote field is "no footnote", not a footnote that
    // says nothing, so it is left out rather than shipped 6,000 times.
    return [`${s}:${a}`, f ? { t, f } : { t }];
  });
}

/**
 * The whole file, or a refusal. `surahs[i]` is surah i+1's API body and
 * `counts[i]` its ayah count in the corpus.
 *
 * `version` is QuranEnc's; where they publish none it is null, and then the
 * date the text was retrieved (`retrieved`) must be there to show instead.
 *
 * @param {{ key: string, title: string, version: string | null, retrieved?: string, language: string, dir: string }} meta
 * @param {unknown[]} surahs
 * @param {number[]} counts
 */
export function assemble(meta, surahs, counts) {
  if (counts.length !== 114) throw new Error(`the corpus has ${counts.length} surahs`);
  if (surahs.length !== 114) throw new Error(`${meta.key}: ${surahs.length} of 114 surahs`);
  /** @type {Record<string, { t: string, f?: string }>} */
  const ayahs = {};
  for (let s = 1; s <= 114; s++) {
    for (const [ref, entry] of surahEntries(s, counts[s - 1], surahs[s - 1])) ayahs[ref] = entry;
  }
  const n = Object.keys(ayahs).length;
  // Counted again on the finished object, against the Quran's own number and
  // not only the corpus's: if both ever disagree with 6,236, something is
  // wrong that no translation should be written on top of.
  if (n !== AYAH_TOTAL) throw new Error(`${meta.key}: ${n} ayahs, expected ${AYAH_TOTAL} — nothing written`);
  if (meta.dir !== "rtl" && meta.dir !== "ltr") throw new Error(`${meta.key}: direction ${JSON.stringify(meta.dir)}`);
  if (!meta.version && !/^\d{4}-\d{2}-\d{2}$/.test(meta.retrieved ?? "")) throw new Error(`${meta.key}: no version and no retrieval date`);
  return {
    source: "QuranEnc.com",
    key: meta.key,
    title: meta.title,
    version: meta.version || null,
    ...(meta.version ? {} : { retrieved: meta.retrieved }),
    language: meta.language,
    dir: meta.dir,
    ayahs,
  };
}
