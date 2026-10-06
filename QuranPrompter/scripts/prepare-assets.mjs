#!/usr/bin/env node
// Puts the engine's generated data where the site serves it (public/data/,
// gitignored). Runs before `dev` and `build`.
//
// quran.json is the app; translit.json is asked for only by a reciter who
// turns the Latin reading on, and each of translations/ only by one who picks
// that translation, so they are copied but deliberately kept OUT of the
// service worker's precache — see vite.config.ts EXCLUDED.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dataSrc = require.resolve("@alketab/quran-engine/data/quran.json");
if (!existsSync(dataSrc)) {
  console.error(`missing ${dataSrc} — run \`npm run data -w Engine\``);
  process.exit(1);
}
const dataOut = resolve(here, "../public/data");
mkdirSync(dataOut, { recursive: true });
copyFileSync(dataSrc, resolve(dataOut, "quran.json"));

// Optional, and it has to be optional all the way down: `require.resolve`
// THROWS on a file that is not there, so a missing translit.json would fail
// the build rather than leaving one setting unavailable.
let has = false;
try {
  const trSrc = require.resolve("@alketab/quran-engine/data/translit.json");
  if (existsSync(trSrc)) {
    copyFileSync(trSrc, resolve(dataOut, "translit.json"));
    has = true;
  }
} catch {
  /* not there — the Latin reading is simply unavailable */
}

// The translations of the meanings — the same deal as translit.json: each is
// fetched only by a reciter who picks it, so all are copied and none is
// precached. The folder is replaced whole, so a translation dropped from the
// engine does not linger in public/ and get published by accident.
let meanings = 0;
try {
  const manifest = require.resolve("@alketab/quran-engine/data/translations/manifest.json");
  const out = resolve(dataOut, "translations");
  rmSync(out, { recursive: true, force: true });
  // Not dotfiles: a .DS_Store that Finder leaves in the engine's folder would
  // otherwise ride along into dist/ and be published.
  cpSync(dirname(manifest), out, { recursive: true, filter: (src) => !basename(src).startsWith(".") });
  meanings = readdirSync(out).filter((f) => f.endsWith(".json") && f !== "manifest.json").length;
} catch {
  /* not generated — see Engine/scripts/fetch-translations.mjs */
}
console.log(`data: quran.json${has ? " + translit.json" : ""}${meanings ? ` + ${meanings} translations` : ""} → public/data/`);
