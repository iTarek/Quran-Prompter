import type { AyahRef } from "@alketab/quran-engine";

/** How the prompter behaves for this sitting — see `Prefs.mode`. */
export type Mode = "recognize" | "praying" | "reading" | "memorizing";

/** Display order: the default first, then the rest. */
export const MODES: readonly Mode[] = ["reading", "recognize", "praying", "memorizing"];

/** The highlight colours — see `theme.ts` for what each one is. */
export type Palette = "jungle" | "dawn" | "ocean";
export const PALETTES: readonly Palette[] = ["jungle", "dawn", "ocean"];

/** The background behind everything — see `theme.ts`. */
export type Backdrop = "black" | "midnight" | "graphite";
export const BACKDROPS: readonly Backdrop[] = ["black", "midnight", "graphite"];

/**
 * The prompter settings, persisted under the iOS app's own keys.
 *
 * **One mode, not two switches.** The two booleans this replaced could express
 * a state that does not exist — both on — and `Prefs` had to keep undoing it.
 * A single mode cannot say the impossible thing, so nothing has to defend
 * against it:
 *
 *   reading    locate once and stay; silence never ends the run and a finished
 *              surah rolls into the next. The default — it is what someone
 *              opening the site is nearly always doing, and the mode that
 *              keeps its own place.
 *   recognize  find the reciter anywhere, re-find them after silence, follow
 *              them to any surah.
 *   praying    every new search leans toward الفاتحة, because a rak‘ah just
 *              ended and another is beginning.
 *
 * The two legacy keys are still what is WRITTEN, so a reciter who already
 * chose a setting keeps it and the storage stays aligned with the iOS app's.
 */
export class Prefs {
  private static readonly FONT = "prompterFontMulti";
  private static readonly FATIHAH = "prompterExpectFatihah";
  private static readonly LOCATE_ONCE = "prompterLocateOnce";
  /** Where the reciter was, so reading can offer to resume — see `lastRead`. */
  private static readonly LAST_READ = "prompterLastRead";
  private static readonly MISTAKE_SOUND = "prompterMistakeSound";
  /** The Latin reading under each word — see `translit`. */
  private static readonly TRANSLIT = "prompterTranslit";
  /** Which translation of the meanings shows under the ayah — see `meaning`. */
  private static readonly MEANING = "prompterMeaning";
  private static readonly PALETTE = "prompterPalette";
  private static readonly BACKDROP = "prompterBackdrop";
  /**
   * The mode, by name. Two booleans could encode three modes; a fourth would
   * need a third boolean and then eight combinations for four real states.
   * The name IS the state. The old keys are still written so a reciter who
   * goes back to an older build keeps their setting.
   */
  private static readonly MODE = "prompterMode";
  private listeners: (() => void)[] = [];
  private _fontMulti: number;
  private _mode: Mode;
  private _lastRead: AyahRef;
  private _mistakeSound: boolean;
  private _translit: boolean;
  private _meaning: string | null;
  private _palette: Palette;
  private _backdrop: Backdrop;

  constructor() {
    this._fontMulti = Prefs.clamp(Number(read(Prefs.FONT) ?? 1.2) || 1.2);
    this._mode = Prefs.readMode();
    this._lastRead = Prefs.parseRef(read(Prefs.LAST_READ));
    // OFF unless it was explicitly switched on. A sound this app makes by
    // itself has to be asked for: the phone may be on the floor in prayer, in
    // a room with other people, or beside someone else reciting.
    this._mistakeSound = read(Prefs.MISTAKE_SOUND) === "1";
    this._translit = read(Prefs.TRANSLIT) === "1";
    // OFF unless a translation was picked — and picking one is a download, so
    // it is never the default. Anything stored that is not a key is off.
    this._meaning = Prefs.meaningKey(read(Prefs.MEANING));
    // Jungle took the default's place from Aurora; a stored "aurora" is no
    // longer a palette, so it falls back to the default — which is Jungle.
    this._palette = oneOf(read(Prefs.PALETTE), PALETTES, "jungle");
    // Black is the default for the reason the app was black before it had a
    // choice: it is read in dark rooms, in prayer, and from across a room.
    this._backdrop = oneOf(read(Prefs.BACKDROP), BACKDROPS, "black");
  }

  static clamp(v: number): number {
    return Math.min(2.2, Math.max(0.8, Math.round(v * 10) / 10));
  }

  get fontMulti(): number {
    return this._fontMulti;
  }
  set fontMulti(v: number) {
    const c = Prefs.clamp(v);
    if (c === this._fontMulti) return;
    this._fontMulti = c;
    write(Prefs.FONT, String(c));
    this.emit();
  }

  get mode(): Mode {
    return this._mode;
  }
  set mode(v: Mode) {
    if (v === this._mode || !MODES.includes(v)) return;
    this._mode = v;
    write(Prefs.MODE, v);
    // Kept in step for an older build reading them back. `memorizing` follows
    // reading's engine behaviour, which is what those two keys described.
    write(Prefs.FATIHAH, v === "praying" ? "1" : "0");
    write(Prefs.LOCATE_ONCE, v === "reading" || v === "memorizing" ? "1" : "0");
    this.emit();
  }

  /**
   * The stored mode, or the one the two older keys described. A reciter who
   * set a mode before this key existed keeps it.
   */
  private static readMode(): Mode {
    const named = read(Prefs.MODE);
    if (named && (MODES as readonly string[]).includes(named)) return named as Mode;
    if (read(Prefs.FATIHAH) === "1") return "praying";
    if (read(Prefs.LOCATE_ONCE) === "1") return "reading";
    // Either legacy key PRESENT but neither set is a reciter who chose
    // recognize back when it was the default, and they keep it. Only a first
    // visit — no key of any kind — takes the new default.
    if (read(Prefs.FATIHAH) !== null || read(Prefs.LOCATE_ONCE) !== null) return "recognize";
    return "reading";
  }

  /**
   * Sound a cue on a wrong word — reading modes only, off until asked for.
   *
   * Not offered to the other two: prayer is the one place this app is used
   * with the phone on the floor and nothing should make a noise there, and
   * recognize mode is for following someone else recite, where the mistakes
   * are not the listener's to be told about.
   */
  get mistakeSound(): boolean {
    return this._mistakeSound;
  }
  set mistakeSound(v: boolean) {
    if (v === this._mistakeSound) return;
    this._mistakeSound = v;
    write(Prefs.MISTAKE_SOUND, v ? "1" : "0");
    this.emit();
  }

  /**
   * Show each word's Latin reading under it, for a reciter who does not read
   * the Arabic script well. Off until asked for: it costs a download, and it
   * puts a second line of text under every word on the page.
   *
   * This is the SETTING. What the page acts on is `showTranslit`, which also
   * knows about review mode.
   */
  get translit(): boolean {
    return this._translit;
  }
  set translit(v: boolean) {
    if (v === this._translit) return;
    this._translit = v;
    write(Prefs.TRANSLIT, v ? "1" : "0");
    this.emit();
  }

  /**
   * Whether the readings actually show. Never where the words are HIDDEN —
   * which is the reason, not the mode's name: a blank is hidden to test what
   * you remember, and a Latin reading under it hands back exactly what was
   * taken away. Any later mode that hides words inherits this for free.
   */
  get showTranslit(): boolean {
    return this._translit && !this.hideWords;
  }

  /**
   * The translation of the meanings shown with the ayah being recited — a
   * QuranEnc key such as `english_saheeh` — or null for none.
   *
   * Set only once that translation is ON THE DEVICE (`Meanings.choose`): a
   * download that fails must leave the app exactly as it was, so the setting
   * never names a translation that is not there to show.
   *
   * This is the SETTING. What the page acts on is `showMeaning`, which also
   * knows about review mode.
   */
  get meaning(): string | null {
    return this._meaning;
  }
  set meaning(v: string | null) {
    const key = Prefs.meaningKey(v);
    if (key === this._meaning) return;
    this._meaning = key;
    write(Prefs.MEANING, key ?? "");
    this.emit();
  }

  /**
   * Whether the meaning shows. Never where the words are HIDDEN, for the
   * reason `showTranslit` gives: a blank is there to test what you remember,
   * and the meaning of the ayah under it hands back what was taken away. The
   * setting is left alone, so leaving review mode brings it back.
   */
  get showMeaning(): boolean {
    return this._meaning !== null && !this.hideWords;
  }

  /** A QuranEnc key — lower case, digits and underscores — or none. */
  private static meaningKey(raw: string | null): string | null {
    return raw && /^[a-z0-9_]{1,64}$/.test(raw) ? raw : null;
  }

  /** Which colours light up the words the reciter has said. */
  get palette(): Palette {
    return this._palette;
  }
  set palette(v: Palette) {
    if (v === this._palette || !PALETTES.includes(v)) return;
    this._palette = v;
    write(Prefs.PALETTE, v);
    this.emit();
  }

  /** The background behind the page and every screen. */
  get backdrop(): Backdrop {
    return this._backdrop;
  }
  set backdrop(v: Backdrop) {
    if (v === this._backdrop || !BACKDROPS.includes(v)) return;
    this._backdrop = v;
    write(Prefs.BACKDROP, v);
    this.emit();
  }

  /** Lean the next search toward الفاتحة — prayer only. */
  get expectFatihah(): boolean {
    return this._mode === "praying";
  }

  /**
   * Locate once and stay on the surah. Memorizing is reading's engine with the
   * words hidden — the same sitting, tested rather than read.
   */
  get locateOnce(): boolean {
    return this._mode === "reading" || this._mode === "memorizing";
  }

  /**
   * Whether this mode offers the surah index on the start screen. Both of the
   * sittings that begin on one surah and stay there do.
   */
  get canChooseSurah(): boolean {
    return this._mode === "reading" || this._mode === "memorizing";
  }

  /**
   * Whether the place reached is worth keeping. Reading only: memorizing is a
   * test of what you know, and how far you got in one has no business moving
   * the bookmark you read from.
   */
  get remembersPlace(): boolean {
    return this._mode === "reading";
  }

  /**
   * Hide the words until they are recited — memorizing only.
   *
   * A word keeps its place and its width while hidden, so the ayah still shows
   * how long it is and how many words are in it, and revealing one moves
   * nothing on the page.
   */
  get hideWords(): boolean {
    return this._mode === "memorizing";
  }

  /**
   * The ayah the reciter last reached, so reading can offer to pick it up
   * again. Only written in reading mode: the other two are for a sitting that
   * starts wherever the reciter starts, and remembering a place they did not
   * ask to keep would put a stale surah on the button.
   */
  get lastRead(): AyahRef {
    return this._lastRead;
  }
  set lastRead(ref: AyahRef) {
    if (ref.surah === this._lastRead.surah && ref.ayah === this._lastRead.ayah) return;
    this._lastRead = ref;
    write(Prefs.LAST_READ, `${ref.surah}:${ref.ayah}`);
    // Deliberately no `emit()`: this changes as the reciter reads, and the
    // listeners are settings observers — the font, the engine's mode. The one
    // place that needs it reads it when the start screen is built.
  }

  /** «الفاتحة ١» until they have read something. */
  private static parseRef(raw: string | null): AyahRef {
    const [s, a] = (raw ?? "").split(":").map(Number);
    if (!Number.isInteger(s) || !Number.isInteger(a) || s < 1 || s > 114 || a < 1) return { surah: 1, ayah: 1 };
    return { surah: s, ayah: a };
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private emit(): void {
    // Copied: a listener may unsubscribe (or subscribe) while being called,
    // and splicing the array under the loop would skip its neighbour.
    for (const fn of [...this.listeners]) fn();
  }
}

/** A stored value if it is one of the known ones — anything else is the default. */
function oneOf<T extends string>(raw: string | null, known: readonly T[], fallback: T): T {
  return raw !== null && (known as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — fine */
  }
}
