import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// The build script's own checks, imported as they ship — a plain .mjs.
import { assemble, AYAH_TOTAL, surahEntries, translatorOf } from "../scripts/translations.mjs";
import { loadCorpus } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../data/translations");

/** The corpus's ayah count per surah — what the script checks QuranEnc against. */
function counts(): number[] {
  const c = loadCorpus();
  return Array.from({ length: 114 }, (_, i) => c.surah(i + 1).ayahCount);
}

/** A whole translation, as the API would send it: 114 bodies, one row per ayah. */
function api(): { result: { sura: string; aya: string; translation: string; footnotes: string }[] }[] {
  return counts().map((n, i) => ({
    result: Array.from({ length: n }, (_, a) => ({
      sura: String(i + 1),
      aya: String(a + 1),
      translation: `meaning of ${i + 1}:${a + 1}`,
      footnotes: a === 0 ? "[1] a note" : "",
    })),
  }));
}

const META = { key: "test_key", title: "Test Translation - A. Translator", version: "1.0.0", language: "en", dir: "ltr" };

describe("fetch-translations: the 6,236 check", () => {
  it("writes a complete translation, every ayah once, keyed s:a", () => {
    const file = assemble(META, api(), counts());
    expect(Object.keys(file.ayahs)).toHaveLength(AYAH_TOTAL);
    expect(AYAH_TOTAL).toBe(6236);
    expect(file.ayahs["2:255"]).toEqual({ t: "meaning of 2:255" });
    expect(file.ayahs["114:6"]).toEqual({ t: "meaning of 114:6" });
    expect(file.source).toBe("QuranEnc.com");
  });

  it("refuses a translation one ayah short", () => {
    const surahs = api();
    surahs[1].result.pop(); // البقرة without 2:286
    expect(() => assemble(META, surahs, counts())).toThrow(/surah 2: 285 ayahs, the corpus has 286/);
  });

  it("refuses a missing surah", () => {
    const surahs = api().slice(0, 113);
    expect(() => assemble(META, surahs, counts())).toThrow(/113 of 114 surahs/);
  });

  it("refuses an ayah out of place, even when the count is right", () => {
    const surahs = api();
    surahs[0].result[3].aya = "5"; // 1:4 missing, 1:5 twice
    expect(() => assemble(META, surahs, counts())).toThrow(/row 4 is 1:5/);
  });

  it("refuses an ayah whose translation is empty", () => {
    const surahs = api();
    surahs[54].result[12].translation = "  ";
    expect(() => assemble(META, surahs, counts())).toThrow(/55:13 has no translation/);
  });

  // QuranEnc's terms: never modify, add or delete. Not even whitespace.
  it("keeps the text and the footnotes byte for byte", () => {
    const surahs = api();
    surahs[0].result[0].translation = "  In the name of Allāh,[2] the Entirely Merciful \n";
    surahs[0].result[0].footnotes = "[2] Allāh is a proper name.\n[3] second";
    const file = assemble(META, surahs, counts());
    expect(file.ayahs["1:1"]).toEqual({ t: "  In the name of Allāh,[2] the Entirely Merciful \n", f: "[2] Allāh is a proper name.\n[3] second" });
  });

  // QuranEnc publishes no version for the Arabic tafsir: the date the text was
  // retrieved stands in, and a file with neither is refused.
  it("takes a retrieval date in place of a version QuranEnc does not publish — never neither", () => {
    const file = assemble({ ...META, version: null, retrieved: "2026-10-04" }, api(), counts());
    expect(file.version).toBeNull();
    expect(file.retrieved).toBe("2026-10-04");
    expect(() => assemble({ ...META, version: null }, api(), counts())).toThrow(/no version and no retrieval date/);
    expect(assemble(META, api(), counts())).not.toHaveProperty("retrieved");
  });

  it("reads the translator out of a title in either language", () => {
    expect(translatorOf("English Translation - Noor International Center")).toBe("Noor International Center");
    expect(translatorOf("الترجمة الإسبانية (أمريكا اللاتينية) - عيسى غارسيا")).toBe("عيسى غارسيا");
    expect(translatorOf("No dash at all")).toBe("No dash at all");
  });

  it("checks a surah's rows on their own", () => {
    expect(() => surahEntries(1, 7, { result: [] })).toThrow(/0 ayahs/);
    expect(() => surahEntries(1, 7, {})).toThrow(/no result array/);
  });
});

// The committed files, read back: what the site will serve.
describe("data/translations, as committed", () => {
  const manifest = JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8")) as {
    translations: { key: string; dir: string; version: string; bytes: number; translator: { en: string; ar: string } }[];
  };

  it("lists exactly the files that are there", () => {
    // Translations only: not the manifest, and not the .DS_Store Finder leaves.
    const files = readdirSync(dataDir)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(manifest.translations.map((t) => t.key).sort()).toEqual(files);
  });

  it.each(manifest.translations.map((t) => [t.key, t] as const))("%s covers all 6,236 ayahs and matches its manifest entry", (key, entry) => {
    const raw = readFileSync(resolve(dataDir, `${key}.json`));
    const file = JSON.parse(raw.toString("utf8")) as { key: string; version: string; dir: string; source: string; ayahs: Record<string, { t: string }> };
    expect(file.source).toBe("QuranEnc.com");
    expect(file.key).toBe(key);
    expect(file.version).toBe(entry.version);
    expect(file.dir).toBe(entry.dir);
    expect(raw.length).toBe(entry.bytes);
    expect(entry.translator.en && entry.translator.ar).toBeTruthy();
    const c = loadCorpus();
    let n = 0;
    for (let s = 1; s <= 114; s++) {
      for (let a = 1; a <= c.surah(s).ayahCount; a++) {
        expect(file.ayahs[`${s}:${a}`]?.t, `${key} ${s}:${a}`).toBeTruthy();
        n++;
      }
    }
    expect(Object.keys(file.ayahs)).toHaveLength(n);
    expect(n).toBe(6236);
  });
});
