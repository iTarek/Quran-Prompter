import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { defineConfig, type Plugin } from "vite";

// The model and the Quran data are served from public/ under stable names,
// and both are cached in the browser by URL: the model by the engine, in the
// Cache API, and quran.json by the service worker (and by the HTTP cache).
// Without a version in the URL, shipping a new file would leave every
// returning visitor on the old one forever — no symptom, and no way out but
// clearing site data. The file's own content hash is the version, so a cache
// misses exactly when the bytes change.
const MODEL_FILE = "public/models/quran_phoneme_zipformer.onnx";
const DATA_FILE = "public/data/quran.json";
const TRANSLIT_FILE = "public/data/translit.json";
function hashOf(file: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(new URL(file, import.meta.url))).digest("hex").slice(0, 8);
  } catch {
    return null; // absent — `npm run dev` still runs; `npm run build` refuses (see below)
  }
}
const MODEL_VERSION = hashOf(MODEL_FILE);
const DATA_VERSION = hashOf(DATA_FILE);
const TRANSLIT_VERSION = hashOf(TRANSLIT_FILE);

/**
 * The translations of the meanings the picker offers — the engine's manifest
 * (Engine/scripts/fetch-translations.mjs), each entry given its file's content
 * hash for its `?v=`, for the reason every other data file has one. Baked into
 * the bundle rather than fetched: the picker must list what is on offer with
 * no network, and the one translation a reciter picked must be findable in
 * their cache by the exact URL it was stored under. A translation whose file
 * is missing is left out, never offered and then failed.
 */
const MEANINGS_DIR = "public/data/translations/";
function meanings(): unknown[] {
  let manifest: { translations?: { key: string }[] };
  try {
    manifest = JSON.parse(readFileSync(new URL(`${MEANINGS_DIR}manifest.json`, import.meta.url), "utf8"));
  } catch {
    return []; // not generated — the setting simply offers nothing but «off»
  }
  return (manifest.translations ?? []).flatMap((entry) => {
    const hash = hashOf(`${MEANINGS_DIR}${entry.key}.json`);
    return hash ? [{ ...entry, hash }] : [];
  });
}
const MEANINGS = meanings();

// The version shown in the info sheet's colophon. package.json is its only
// home, so it cannot drift from the release. Shown IN FULL, patch included:
// it is bumped on every change, and its job is to
// answer "which build am I actually looking at?" — which a version that hides
// its patch cannot do.
const APP_VERSION = (JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string }).version;

// COOP/COEP make the page cross-origin isolated, which is what lets
// onnxruntime-web use threads (SharedArrayBuffer). The same two headers are
// needed wherever the site is deployed.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

// Canonical/Open Graph URLs must be absolute, so they are baked in at build
// time. The default is the live domain, so a plain `npm run build` is correct;
// override only to publish somewhere else:
//   SITE_URL=https://example.test npm run build
// If the site ever moves, change THIS line rather than relying on everyone
// remembering the environment variable.
const SITE_URL = (process.env.SITE_URL ?? "https://prompter.alketab.app").replace(/\/$/, "");

/**
 * The service worker (src/sw.ts — read its header first) makes the site open
 * with no network. This plugin generates dist/sw.js AFTER everything else has
 * landed in dist/, because the worker must know the exact final URL of every
 * file it caches:
 *
 *   1. strip from dist/ what must not be published (STRIPPED below) — done
 *      here and not in package.json so that ONE list decides both what is
 *      shipped and what is precached: a file removed after the list was made
 *      would 404 at install and silently leave the site online-only;
 *   2. walk dist/, skip EXCLUDED, and map each file to the URL the page
 *      actually requests (pages to `/` and `/en/`, quran.json to its `?v=`);
 *   3. hash the sorted list plus every file's content into the build id, so a
 *      byte-identical rebuild yields a byte-identical sw.js and the browser
 *      sees no update — which is why sitemap.xml, whose `lastmod` changes
 *      daily, is excluded;
 *   4. transpile src/sw.ts with `typescript` alone (no bundling: a service
 *      worker must be a single plain script at a stable URL) and prepend the
 *      three `__SW_*__` constants it declares.
 *
 * KILL SWITCH — if the worker ever misbehaves in the field:
 *   QT_SW=off npm run build   →  publish as usual
 * ships a worker that removes its caches, unregisters, and reloads its pages;
 * the next normal build re-enables it.
 */
const SW_SOURCE = "src/sw.ts";
const SW_KILL = process.env.QT_SW === "off"; // read by the worker AND the page (src/offline.ts) via `define`
const STRIPPED = [
  "test", // local WAVs for `?audio=`, never published
];
const EXCLUDED = [
  /^models\//, // the engine caches the model itself, keyed by its `?v=` URL — never twice
  /^sw\.js$/,
  /(^|\/)\./, // .DS_Store and friends
  /\.map$/, // source maps: DevTools only
  // Fetched only by a reciter who turns the Latin reading on, and its `?v=`
  // hash makes the copy they get immutable. Precaching it would put 584 KB
  // into every first visit for a setting most never open.
  /^data\/translit\.json$/,
  // The translations of the meanings: 1-6 MB each, and a reciter wants one at
  // most. The one they pick is kept in its own cache (src/meaning.ts) — the
  // manifest is baked into the bundle, so nothing in this folder is read
  // except by that choice.
  /^data\/translations\//,
  /^robots\.txt$/,
  /^sitemap\.xml$/, // and its lastmod would change the build id every day
  /^og\.png$/, // social-preview image: crawlers only
];

function serviceWorker(): Plugin {
  const here = fileURLToPath(new URL(".", import.meta.url));
  let outDir = join(here, "dist");
  const kill = SW_KILL;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });

  const urlFor = (file: string): string => {
    if (file === "index.html") return "/";
    if (file === "en/index.html") return "/en/";
    if (file === "data/quran.json") return `/data/quran.json?v=${DATA_VERSION}`;
    return encodeURI(`/${file}`);
  };

  return {
    name: "service-worker",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    buildStart() {
      // A build without either file would publish a site that cannot start.
      // It used to build anyway with a "dev" version baked in; refuse instead.
      if (MODEL_VERSION === null) throw new Error(`${MODEL_FILE} is missing — run \`npm run fetch-model\` first`);
      if (DATA_VERSION === null) throw new Error(`${DATA_FILE} is missing — run \`npm run prepare-assets\` first`);
    },
    closeBundle() {
      for (const name of STRIPPED) rmSync(join(outDir, name), { recursive: true, force: true });

      const entries = kill
        ? []
        : walk(outDir)
            .map((path) => relative(outDir, path).split("\\").join("/"))
            .filter((file) => !EXCLUDED.some((rule) => rule.test(file)))
            .map((file) => ({ file, url: urlFor(file), size: statSync(join(outDir, file)).size }))
            .sort((a, b) => (a.url < b.url ? -1 : 1));

      const source = readFileSync(join(here, SW_SOURCE), "utf8");
      if (/^\s*(import|export)\s/m.test(source)) {
        throw new Error(`${SW_SOURCE} must stay a plain script — it is transpiled, not bundled, and a service worker cannot import`);
      }

      // The worker's own source is part of the id too, so a logic change gets
      // a fresh cache instead of sharing one with the build still running.
      const digest = createHash("sha256").update(source).update("\n");
      for (const { file, url } of entries) {
        digest.update(url).update("\n").update(createHash("sha256").update(readFileSync(join(outDir, file))).digest()).update("\n");
      }
      const build = kill ? "off" : digest.digest("hex").slice(0, 8);
      const { outputText, diagnostics } = ts.transpileModule(source, {
        fileName: SW_SOURCE,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: false, newLine: ts.NewLineKind.LineFeed },
      });
      if (diagnostics?.length) throw new Error(`${SW_SOURCE}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n")}`);

      const body = [
        `// GENERATED by vite.config.ts from ${SW_SOURCE} — do not edit; do not rename (the browser knows this worker by its URL).`,
        `// build ${build}${kill ? " — KILL SWITCH: this worker only removes its caches and unregisters" : ""}`,
        `const __SW_BUILD__ = ${JSON.stringify(build)};`,
        `const __SW_PRECACHE__ = ${JSON.stringify(entries.map((e) => e.url), null, 2)};`,
        `const __SW_KILL__ = ${kill};`,
        "",
        outputText,
      ].join("\n");
      writeFileSync(join(outDir, "sw.js"), body);

      const mb = (entries.reduce((sum, e) => sum + e.size, 0) / 1e6).toFixed(1);
      const log = this.environment?.logger ?? console;
      if (kill) log.warn(`\n[service-worker] QT_SW=off — dist/sw.js is the KILL SWITCH: it disables offline for everyone who loads this build\n`);
      else log.info(`\n[service-worker] build ${build}: ${entries.length} files, ${mb} MB precached — see dist/sw.js\n`);
    },
  };
}

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  define: {
    __MODEL_VERSION__: JSON.stringify(MODEL_VERSION ?? "dev"),
    __DATA_VERSION__: JSON.stringify(DATA_VERSION ?? "dev"),
    __TRANSLIT_VERSION__: JSON.stringify(TRANSLIT_VERSION ?? "dev"),
    __MEANINGS__: JSON.stringify(MEANINGS),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __SW_KILL__: JSON.stringify(SW_KILL),
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@alketab/quran-engine", "onnxruntime-web"] },
  build: {
    target: "es2022",
    sourcemap: true,
    // Two pages, one bundle: `/` is Arabic and `/en/` is English. Separate URLs
    // are what makes hreflang possible — a client-side toggle alone gives a
    // crawler nothing to index in the second language.
    rollupOptions: { input: { main: "index.html", en: "en/index.html" } },
  },
  plugins: [
    {
      name: "site-url",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html.replaceAll("__SITE_URL__", SITE_URL),
      },
      // robots.txt and sitemap.xml carry the absolute URL too, so they are
      // emitted here rather than kept in public/ where they would go stale the
      // moment the site moves to its own domain.
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "robots.txt",
          source: [
            "User-agent: *",
            "Allow: /",
            "",
            "# The model, its runtime and the Quran data are machine assets, not pages.",
            "Disallow: /models/",
            "Disallow: /assets/",
            "Disallow: /data/",
            "",
            `Sitemap: ${SITE_URL}/sitemap.xml`,
            "",
          ].join("\n"),
        });
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
            ...["/", "/en/"].flatMap((path) => [
              "  <url>",
              `    <loc>${SITE_URL}${path}</loc>`,
              `    <xhtml:link rel="alternate" hreflang="ar" href="${SITE_URL}/"/>`,
              `    <xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/en/"/>`,
              `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/"/>`,
              `    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>`,
              "    <changefreq>weekly</changefreq>",
              `    <priority>${path === "/" ? "1.0" : "0.9"}</priority>`,
              "  </url>",
            ]),
            "</urlset>",
            "",
          ].join("\n"),
        });
      },
    },
    serviceWorker(),
  ],
});
