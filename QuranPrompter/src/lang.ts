/**
 * UI language. Arabic is the default; the choice is remembered exactly like
 * the font size, under its own `localStorage` key.
 *
 * The INTERFACE follows the language — header, start screen, tab bar, sheets,
 * the About page all run left-to-right in English. The MUSHAF never does: the
 * Quran does not change direction because the buttons are in English, so the
 * page sets `direction: rtl` on itself and ignores this.
 */
export type Lang = "ar" | "en";

const KEY = "prompterLang";
const listeners: (() => void)[] = [];
// `/en/` is an explicit request for English — a shared link must arrive in the
// language it advertises. Anywhere else, the remembered choice decides.
let current: Lang = location.pathname.startsWith("/en") ? "en" : (read() ?? "ar");

function read(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "ar" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function lang(): Lang {
  return current;
}

/** `rtl` for Arabic, `ltr` for English — the interface's direction, never the mushaf's. */
export function uiDir(): "rtl" | "ltr" {
  return current === "ar" ? "rtl" : "ltr";
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode — the session still switches, it just will not persist */
  }
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

/** Numbers in the interface: Arabic-Indic digits in Arabic, Western digits in English. */
export function formatNumber(n: number): string {
  return current === "en" ? String(n) : arabicDigits(n);
}

/**
 * Arabic-Indic digits whatever the language — for the ayah markers, which are
 * part of the mushaf, not of the interface around it.
 */
export function arabicDigits(n: number | string): string {
  const digits = "٠١٢٣٤٥٦٧٨٩";
  return String(n).replace(/[0-9]/g, (d) => digits[Number(d)]);
}

/** A surah's name in the active language — «الفَاتِحة» or "Al-Fātiḥah". */
export function surahName(info: { name: string; nameEn: string }): string {
  return current === "en" ? info.nameEn : info.name;
}
