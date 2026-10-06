/**
 * Inline SVG icons, 24-unit grid, drawn in the stroke of whatever holds them.
 *
 * Each carries its OWN stroke weight — the design gives the mic 1.6, the close
 * cross 1.8, the bars 1.7 — so the weight is part of the icon rather than of
 * the button it happens to sit in. Size is the container's business, in CSS.
 */
const svg = (body: string, weight: number) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  /** Settings — two sliders. */
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>', 1.6),
  /** About / help — a question mark with no ring, so it sits as light as the sliders. */
  help: svg('<path d="M9.2 9.2a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1.1-1.3 2v.7"/><circle cx="12" cy="17.6" r=".6" fill="currentColor"/>', 1.7),
  mic: svg('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 1.6),
  /** The failure screen: a microphone that was denied or is unavailable. */
  micSlash: svg('<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/><path d="M3 3l18 18"/>', 1.5),
  /** The resume button — the place kept for you. */
  bookmark: svg('<path d="M6 3h12v18l-6-4-6 4z"/>', 1.7),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 1.8),
  /** Back out of the About page. Points toward the start of the line. */
  back: svg('<path d="M15 6l-6 6 6 6"/>', 1.7),
  /** Open a sheet further — points up; turned over when it is open. */
  chevron: svg('<path d="M6 15l6-6 6 6"/>', 1.7),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', 1.7),
  /** Tap a word to hear it. */
  speaker: svg('<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>', 1.6),
  /** «تواصل معنا» — write to us. */
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.8 6.8L12 12.8l8.2-6"/>', 1.6),
  /** Install to the home screen. */
  install: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/>', 1.7),
  // The four modes, as the tab bar draws them.
  reading: svg('<path d="M3 5.5c3-1.3 6-1.3 9 .8 3-2.1 6-2.1 9-.8V19c-3-1.3-6-1.3-9 .8-3-2.1-6-2.1-9-.8z"/><path d="M12 6.3v13.4"/>', 1.6),
  recognize: svg('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>', 1.7),
  praying: svg('<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>', 1.6),
  memorizing: svg(
    '<path d="M3 3l18 18M10.6 5.1Q11.3 5 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.6 6.6C4.4 8 2.9 10.2 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.6 4.8-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    1.6,
  ),
} as const;

export function icon(name: keyof typeof ICONS): string {
  return ICONS[name];
}
