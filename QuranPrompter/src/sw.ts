/**
 * The service worker — what lets the prompter open with no network at all,
 * once it has been visited once. Handover notes first, code second.
 *
 * WHAT IT DOES
 * - On install it downloads every file of the app shell — the two pages, the
 *   scripts, the 14 MB wasm runtime, the Quran data, the font, the icons —
 *   into ONE cache named after this build (`prompter-<hash>`).
 * - On fetch it answers exactly those URLs from that cache, and touches
 *   nothing else. Not the 72 MB model: the decoder worker caches that for
 *   itself under `quran-engine-model`, keyed by its `?v=` URL, and this file
 *   never opens that cache. Not any URL it did not precache: those go to the
 *   network as if there were no worker.
 * - On activate it deletes the caches of OLDER builds of this worker — only
 *   names starting with `prompter-` — and nothing else.
 *
 * HOW AN UPDATE LANDS — read this before publishing
 * - The build generates dist/sw.js from this file: the precache list and the
 *   build hash are prepended, computed from what actually landed in dist/.
 *   Any changed file → a different sw.js → the browser sees a new worker.
 * - The new worker installs in the background, downloads its shell into a NEW
 *   cache, and then WAITS. The open page keeps the version it loaded, served
 *   from the OLD cache, until every tab of the site is closed. The next launch
 *   runs the new version and drops the old cache.
 * - A reload is NOT enough on desktop: the reloading tab is still a client.
 *   Close every tab (or the installed app), open it again. This is deliberate:
 *   a page and its scripts always come from one build, and no reciter is ever
 *   reloaded mid-surah. There is no skipWaiting() and no clients.claim() here
 *   on purpose; do not add them.
 *
 * RULES
 * - The URL /sw.js is this worker's identity to the browser. Never rename it.
 * - This is a plain script, not a module: no import, no export. The build
 *   transpiles it with `typescript` alone and registers it as a classic
 *   worker (vite.config.ts, plugin "service-worker").
 * - Never hand-edit the precache list; it is generated. If a file must not be
 *   precached, add it to EXCLUDED in vite.config.ts.
 * - Install fails loudly if any file is missing (a 404 rejects the whole
 *   install, the old worker keeps running, the site keeps working online).
 *   That is the right failure: a half-cached shell would open offline and
 *   then break.
 *
 * IF IT EVER MISBEHAVES
 *   QT_SW=off npm run build   →  publish
 * ships the `__SW_KILL__` branch at the bottom: a worker whose only job is to
 * delete every `prompter-*` cache, unregister itself and reload the pages it
 * controls. Nobody has to clear site data.
 */

// Prepended to the transpiled output by the build (see vite.config.ts).
declare const __SW_BUILD__: string; // 8 hex chars, hashed from the precached files
declare const __SW_PRECACHE__: readonly string[]; // absolute URLs on this origin, e.g. "/assets/main-abc123.js"
declare const __SW_KILL__: boolean;

const sw = self as unknown as ServiceWorkerGlobalScope;
const SW_PREFIX = "prompter-";
const SW_CACHE = `${SW_PREFIX}${__SW_BUILD__}`;
const PRECACHED = new Set(__SW_PRECACHE__);

/**
 * A request's cache key: path plus query, so `/data/quran.json?v=…` is one
 * entry and `/` with `?audio=…` still finds `/`. Navigations to either page,
 * with or without the trailing slash or `index.html`, map to the canonical
 * entry the build precached.
 */
function keyFor(request: Request): string | null {
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin || request.method !== "GET") return null;
  if (request.mode === "navigate") {
    if (url.pathname === "/" || url.pathname === "/index.html") return "/";
    if (url.pathname === "/en" || url.pathname === "/en/" || url.pathname === "/en/index.html") return "/en/";
    return null; // any other path: let the host answer (a 404)
  }
  const key = url.pathname + url.search;
  return PRECACHED.has(key) ? key : null;
}

async function precache(): Promise<void> {
  const cache = await caches.open(SW_CACHE);
  await Promise.all(
    [...PRECACHED].map(async (key) => {
      // Content-addressed URLs (a hashed file name or a `?v=`) may come from
      // the HTTP cache — the page has just downloaded most of them, and the
      // hash IS the version. Stable names bypass it, or an hour-old HTTP copy
      // of the font or the manifest could be sealed into a brand-new build.
      const versioned = key.startsWith("/assets/") || key.includes("?v=");
      const response = await fetch(key, { cache: versioned ? "default" : "reload" });
      if (!response.ok) throw new Error(`[sw] precache ${key}: HTTP ${response.status}`);
      // A response that arrived through a redirect cannot be used to answer a
      // navigation later; store a clean copy of the same bytes instead.
      await cache.put(key, response.redirected ? new Response(response.body, response) : response);
    }),
  );
}

async function fromCache(key: string, request: Request): Promise<Response> {
  // One entry per URL by construction, so a host's `Vary` header must not
  // make a lookup miss its own entry.
  const hit = await (await caches.open(SW_CACHE)).match(key, { ignoreVary: true });
  if (hit) return hit;
  // Cannot happen after a successful install; if storage was partly evicted,
  // fall through to the network rather than fail.
  return fetch(request);
}

async function dropOtherBuilds(): Promise<string[]> {
  const stale = (await caches.keys()).filter((name) => name.startsWith(SW_PREFIX) && name !== SW_CACHE);
  await Promise.all(stale.map((name) => caches.delete(name)));
  return stale;
}

if (!__SW_KILL__) {
  sw.addEventListener("install", (event) => {
    event.waitUntil(
      precache().then(
        () => console.info(`[sw] build ${__SW_BUILD__} installed — ${PRECACHED.size} files cached; it starts on the next launch`),
        (e) => {
          console.error(`[sw] build ${__SW_BUILD__} NOT installed: ${e instanceof Error ? e.message : String(e)}`);
          throw e; // the browser drops this worker; the previous one, if any, keeps running
        },
      ),
    );
  });

  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      dropOtherBuilds().then((stale) =>
        console.info(`[sw] build ${__SW_BUILD__} active${stale.length ? `, removed ${stale.join(", ")}` : ""}`),
      ),
    );
  });

  sw.addEventListener("fetch", (event) => {
    const key = keyFor(event.request);
    if (key !== null) event.respondWith(fromCache(key, event.request));
    // No respondWith: the browser fetches normally, exactly as without a worker.
  });
} else {
  // THE KILL SWITCH — built with `QT_SW=off`. Activates at once, removes
  // every cache this worker ever made, unregisters, and reloads the pages
  // that were under the previous worker so they run plainly from the network.
  // Only clients this worker controls are reloaded, and a reloaded page is
  // no longer controlled, so this cannot loop.
  sw.addEventListener("install", () => void sw.skipWaiting());
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const mine = (await caches.keys()).filter((name) => name.startsWith(SW_PREFIX));
        await Promise.all(mine.map((name) => caches.delete(name)));
        await sw.registration.unregister();
        for (const client of await sw.clients.matchAll({ type: "window" })) {
          await client.navigate(client.url).catch(() => undefined);
        }
        console.info(`[sw] kill switch: removed ${mine.length} cache(s), worker unregistered`);
      })(),
    );
  });
}
