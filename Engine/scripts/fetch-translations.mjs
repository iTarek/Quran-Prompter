/**
 * Regenerate `data/translations/` — the translations of the meanings that the
 * prompter shows under the ayah being recited («افهم ما تتلو»).
 *
 *   npm run translations -w Engine                         # refresh every one in the manifest
 *   node Engine/scripts/fetch-translations.mjs german_bubenheim   # add or refresh named keys
 *
 * The source is QuranEnc.com (King Fahd Complex / Rowwad Translation Center),
 * read from its public API: the list for the metadata, then all 114 surahs of
 * each translation. Each becomes `data/translations/<key>.json`:
 *
 *   { source: "QuranEnc.com", key, title, version, language, dir,
 *     ayahs: { "1:1": { t, f? }, … } }
 *
 * and `manifest.json` beside them lists what is there, for the settings
 * picker: the language (its own name for itself, and its English and Arabic
 * names), the translator in both interface languages, the version and the
 * file's size.
 *
 * **It refuses to write a translation unless all 6,236 ayahs are present**,
 * one each, matching the corpus surah by surah (`translations.mjs`). A meaning
 * shown under the wrong ayah is worse than none: the reciter reading it is
 * the one who cannot check it against the Arabic.
 *
 * QuranEnc's terms, which this script exists to keep:
 * - the text is never modified, added to or cut — `t` and `f` are written
 *   exactly as the API returns them, not even trimmed;
 * - the version is shown — it is in every file and in the manifest;
 * - versions are kept current — this one command refreshes all of them, and a
 *   translation whose version moved is reported as such.
 * NOTICE.md lists the shipped translations and the terms in full.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble, translatorOf } from "./translations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../data/translations");
const manifestFile = join(outDir, "manifest.json");
const API = "https://quranenc.com/api/v1";

/**
 * What ships, and the order the picker lists it in — Arabic first, then the
 * rest; anything added later by name goes after these. Ask Tarek before
 * changing it.
 */
const DEFAULT_KEYS = [
  "arabic_moyassar",
  "english_saheeh",
  "french_rashid",
  "spanish_garcia",
  "urdu_junagarhi",
  "indonesian_affairs",
  "turkish_rwwad",
  "german_bubenheim",
];

/**
 * Translations QuranEnc's API serves but its list does not name — so the list
 * cannot say what they are, and this does. The titles are QuranEnc's own page
 * titles (quranenc.com/en/browse/<key>, /ar/browse/<key>).
 *
 * **QuranEnc publishes no version number for these**, anywhere: not in the
 * API, the sqlite download or the page. `version` is null rather than a
 * number made up here, and the date the text was retrieved stands in for it —
 * kept while the text is unchanged, so a refresh that finds nothing new
 * changes nothing.
 */
const UNLISTED = {
  arabic_moyassar: {
    key: "arabic_moyassar",
    language_iso_code: "ar",
    direction: "rtl",
    version: null,
    title: "Arabic Language - At-Tafsir Al-Muyassar",
    titleAr: "اللغة العربية - التفسير الميسر",
  },
};

/** Four at a time: about 20 s a translation, and polite to a free API. */
const PARALLEL = 4;

async function getJson(url, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= attempts) throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((ok) => setTimeout(ok, 800 * i));
    }
  }
}

/** QuranEnc's list in one interface language, by key. */
async function list(localization) {
  const body = await getJson(`${API}/translations/list?localization=${localization}`);
  if (!Array.isArray(body?.translations)) throw new Error(`the ${localization} list has no translations`);
  return new Map(body.translations.map((t) => [t.key, t]));
}

/** "français" → "Français": the language's own name, as a picker shows it. */
function languageName(iso, inLang) {
  const name = new Intl.DisplayNames([inLang], { type: "language" }).of(iso) ?? iso;
  return name.charAt(0).toLocaleUpperCase(inLang) + name.slice(1);
}

const corpus = JSON.parse(readFileSync(join(here, "../data/quran.json"), "utf8"));
const counts = corpus.surahs.map((s) => s.ayahs.length);

const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
const previousEntries = new Map((previous?.translations ?? []).map((e) => [e.key, e]));
const keys = process.argv.slice(2).length ? process.argv.slice(2) : [...new Set([...DEFAULT_KEYS, ...previousEntries.keys()])];

const [en, ar] = await Promise.all([list("en"), list("ar")]);
for (const [key, meta] of Object.entries(UNLISTED)) {
  // Should QuranEnc ever list one of these, its list — and its version — win.
  if (!en.has(key)) en.set(key, meta);
  if (!ar.has(key)) ar.set(key, { ...meta, title: meta.titleAr });
}
const missing = keys.filter((k) => !en.has(k));
if (missing.length) {
  console.error(`not on QuranEnc's list: ${missing.join(", ")} — nothing written`);
  process.exit(1);
}

// Every translation is downloaded and checked BEFORE anything is written. One
// failing — the network, or an ayah missing — then leaves the folder exactly
// as it was, instead of half the files refreshed under a manifest that still
// describes the old ones.
const fetched = [];
for (const key of keys) {
  const meta = en.get(key);
  const started = Date.now();
  const surahs = new Array(114);
  let next = 1;
  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next <= 114) {
        const s = next++;
        surahs[s - 1] = await getJson(`${API}/translation/sura/${key}/${s}`);
      }
    }),
  );
  // Throws — and so writes nothing at all — unless every ayah is there.
  const assembleWith = (retrieved) =>
    assemble({ key, title: meta.title, version: meta.version, retrieved, language: meta.language_iso_code, dir: meta.direction }, surahs, counts);
  const path = join(outDir, `${key}.json`);
  let file = assembleWith(meta.version ? undefined : new Date().toISOString().slice(0, 10));
  if (!meta.version) {
    // No version to show, so the retrieval date is the version: kept as it
    // was while the text is the same, or every refresh would "update" it.
    const kept = previousEntries.get(key)?.retrieved;
    if (kept && existsSync(path) && readFileSync(path, "utf8") === JSON.stringify(assembleWith(kept))) file = assembleWith(kept);
  }
  fetched.push({ key, meta, path, file, seconds: (Date.now() - started) / 1000 });
}

mkdirSync(outDir, { recursive: true });
const written = new Map();
for (const { key, meta, path, file, seconds } of fetched) {
  const text = JSON.stringify(file);
  writeFileSync(path, text);
  const bytes = Buffer.byteLength(text);
  const notes = Object.values(file.ayahs).filter((a) => a.f).length;
  const was = previousEntries.get(key)?.version;
  const moved = was && was !== meta.version ? ` (was v${was})` : "";
  console.log(
    `${key}: ${meta.version ? `v${meta.version}` : `no version (retrieved ${file.retrieved})`}${moved}, 6,236 ayahs, ${notes} with footnotes, ${(bytes / 1024).toFixed(0)} KB, ${seconds.toFixed(1)} s`,
  );
  const iso = meta.language_iso_code;
  written.set(key, {
    key,
    language: iso,
    native: languageName(iso, iso),
    name: { en: languageName(iso, "en"), ar: languageName(iso, "ar") },
    dir: meta.direction,
    translator: { en: translatorOf(meta.title), ar: translatorOf(ar.get(key)?.title ?? meta.title) },
    title: meta.title,
    version: meta.version,
    ...(file.retrieved ? { retrieved: file.retrieved } : {}),
    bytes,
  });
}

// Keys refreshed now replace their old entries in place; the rest are kept as
// they were, so adding one translation does not quietly drop the others. The
// shipped set leads, in its own order; anything else follows as it came.
const order = [...new Set([...DEFAULT_KEYS, ...previousEntries.keys(), ...keys])].filter((k) => written.has(k) || previousEntries.has(k));
const translations = order.map((k) => written.get(k) ?? previousEntries.get(k));
writeFileSync(
  manifestFile,
  `${JSON.stringify({ source: "QuranEnc.com", url: "https://quranenc.com", translations }, null, 2)}\n`,
);
console.log(`manifest.json: ${translations.length} translations`);
