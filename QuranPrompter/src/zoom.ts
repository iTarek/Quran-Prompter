/**
 * The page never zooms. The Quran text has its own size — the settings
 * slider, a pinch on the reading page, ctrl+wheel there — and a zoomed page
 * only pushed the buttons and the orb off the screen, with no way back short
 * of pinching out again.
 *
 * `user-scalable=no` is not enough on its own: Safari has ignored it since
 * iOS 10. Each way in is closed here separately:
 *
 * - **Safari's pinch** (iPhone, iPad, a Mac's trackpad) arrives as its own
 *   `gesture*` events.
 * - **Two fingers moving anywhere** — the start screen, the sheets. On the
 *   reading page its own listener still turns the same pinch into text size.
 * - **ctrl+wheel**, which is also what Chrome and Edge make of a trackpad
 *   pinch. On the reading page it is the text size, handled there first.
 * - **The keyboard's zoom**: ctrl or ⌘ with + − = 0.
 *
 * Double-tap zoom is `touch-action: manipulation` in the stylesheet, and the
 * zoom iOS does on focusing a small input is `maximum-scale=1` in index.html.
 */
export function lockPageZoom(doc: Document = document): void {
  const block = (e: Event) => e.preventDefault();
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    doc.addEventListener(type, block, { passive: false });
  }
  doc.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  doc.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  doc.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && ZOOM_KEYS.has(e.key)) e.preventDefault();
  });
}

const ZOOM_KEYS = new Set(["+", "=", "-", "_", "0"]);
