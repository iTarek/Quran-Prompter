/**
 * Registers the service worker that makes the site open with no network
 * (`src/sw.ts` — read its header before touching either file).
 *
 * Called once, after the model has initialised: the worker's 20 MB precache
 * then never competes with the 72 MB model download on a first visit.
 * Production only — in `vite dev` there is no `sw.js`, and a worker
 * answering dev requests from a cache would hide every edit.
 */

// Baked in by vite.config.ts from the same `QT_SW=off` that builds the
// kill-switch worker, so the page and the worker always agree.
declare const __SW_KILL__: boolean;

export function enableOffline(log: (line: string) => void): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  if (__SW_KILL__) {
    // The kill-switch build. A page still controlled by an earlier worker
    // registers so the kill worker can replace it, clean up and reload; the
    // reloaded page is uncontrolled and has nothing left to undo.
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined);
    }
    log("offline: disabled in this build");
    return;
  }

  navigator.serviceWorker
    // `updateViaCache: "none"`: /sw.js itself is re-fetched from the network on
    // every launch, byte for byte, never from the HTTP cache — that is what
    // makes a published build reach an installed app on the next open.
    .register("/sw.js", { updateViaCache: "none" })
    .then((reg) => {
      if (reg.waiting) log("offline: a new version is installed — it starts after all tabs of the site are closed");
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state !== "installed") return;
          log(
            navigator.serviceWorker.controller
              ? "offline: a new version is installed — it starts after all tabs of the site are closed"
              : "offline: ready — the site now opens without a network",
          );
        });
      });
    })
    .catch((e: unknown) => log(`offline: service worker not registered (${e instanceof Error ? e.message : String(e)})`));
}
