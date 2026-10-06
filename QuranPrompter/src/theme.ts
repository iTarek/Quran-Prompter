import type { Backdrop, Palette, Prefs } from "./prefs.js";

/**
 * The colours the words light up in, and the ground under everything.
 *
 * Three stops per palette, read in order: [0] is where a recited word's
 * gradient ends, [1] is the heart of the palette (the glow, the rings, the
 * accent), and [2] is where the word being said NOW begins. The canvas draws
 * with the same three, so the orb and the page can never disagree.
 *
 * Only THESE follow the palette. The verdicts that are warnings — a wrong word,
 * a skipped one, one the engine is not sure of yet — keep their fixed colours
 * in every palette: red has to mean wrong whatever the reciter picked.
 */
export const PALETTE_STOPS: Record<Palette, readonly [string, string, string]> = {
  jungle: ["#A8E063", "#2FBF71", "#F2C14E"],
  dawn: ["#FFD27A", "#FF8A6B", "#FF5FA2"],
  ocean: ["#7FE3FF", "#4D8DFF", "#8F7BFF"],
};

export const BACKDROP_COLOR: Record<Backdrop, string> = {
  black: "#000000",
  midnight: "#060814",
  graphite: "#111214",
};

let stops: readonly [string, string, string] = PALETTE_STOPS.jungle;

/** The active palette's three stops — for the canvas, which cannot read CSS. */
export function paletteStops(): readonly [string, string, string] {
  return stops;
}

/** `#2FBF71` at alpha → `rgba(47,191,113,a)`, for canvas gradients. */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Write the palette and backdrop onto `:root` as custom properties, and keep
 * them there as the settings change. Everything else derives from these four
 * with `color-mix`, so a new palette is three hex values and nothing more.
 */
export function installTheme(prefs: Prefs, onChange: () => void): void {
  const root = document.documentElement;
  let last = "";
  const apply = () => {
    const key = `${prefs.palette}|${prefs.backdrop}`;
    if (key === last) return;
    last = key;
    stops = PALETTE_STOPS[prefs.palette];
    root.style.setProperty("--c0", stops[0]);
    root.style.setProperty("--c1", stops[1]);
    root.style.setProperty("--c2", stops[2]);
    const bg = BACKDROP_COLOR[prefs.backdrop];
    root.style.setProperty("--bg", bg);
    // The browser chrome around an installed app follows the page, so a
    // midnight page does not sit under a black status bar.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    onChange();
  };
  prefs.onChange(apply);
  apply();
}
