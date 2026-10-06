import type { AyahRef, QuranCorpus } from "@alketab/quran-engine";
import { icon } from "../icons.js";
import { formatNumber, lang, setLang, surahName } from "../lang.js";
import type { Mode } from "../prefs.js";
import { t } from "../strings.js";
import type { Animator } from "./orb.js";

/**
 * «ع | EN» — the language as a two-way switch rather than a button that shows
 * the OTHER language: the header and the settings sheet both carry one, and
 * the choice the reciter is in is always the lit half.
 */
export function langPill(wide = false): HTMLDivElement & { sync(): void } {
  const pill = document.createElement("div");
  pill.className = wide ? "langpill wide" : "langpill";
  pill.setAttribute("role", "group");
  const make = (code: "ar" | "en", short: string, long: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.lang = code;
    b.textContent = wide ? long : short;
    b.onclick = () => setLang(code);
    return b;
  };
  const ar = make("ar", "ع", "العربية");
  const en = make("en", "EN", "English");
  pill.append(ar, en);
  const sync = () => {
    pill.setAttribute("aria-label", t().languageTitle);
    ar.setAttribute("aria-pressed", String(lang() === "ar"));
    en.setAttribute("aria-pressed", String(lang() === "en"));
  };
  sync();
  return Object.assign(pill, { sync });
}

/**
 * The start screen: which mode this sitting is in and what it does, the orb
 * with «ابدأ التلاوة» at its centre, and under it the two other ways in —
 * pick up where you stopped (reading only), or choose a surah.
 *
 * **The button is not decoration — iOS will not hold the screen awake without
 * it.** `navigator.wakeLock.request()` is gated behind user activation; this
 * press arms both the microphone and the wake lock, and it puts the
 * permission prompt where the reciter asked for it.
 */
export class Home {
  readonly el: HTMLDivElement;
  readonly header: HTMLElement;
  private readonly brandName: HTMLSpanElement;
  private readonly pill: HTMLDivElement & { sync(): void };
  private readonly settingsBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly info: HTMLDivElement;
  private readonly modeName: HTMLSpanElement;
  private readonly modeShort: HTMLParagraphElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly startLabel: HTMLSpanElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly chooseBtn: HTMLButtonElement;
  private resumeAt: AyahRef | null = null;
  private mode: Mode | null = null;
  /** Set by main: fired INSIDE the press, so the gesture is still live. `undefined` = listen and find me. */
  onStart: ((from?: AyahRef) => void) | null = null;
  onChoose: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onHelp: (() => void) | null = null;

  constructor(animator: Animator) {
    // ---- header
    this.header = document.createElement("header");
    this.header.className = "hdr";
    const brand = document.createElement("div");
    brand.className = "brand";
    const logo = document.createElement("img");
    logo.src = "/quran-prompter-icon-wave-192.png";
    logo.alt = "";
    this.brandName = document.createElement("span");
    brand.append(logo, this.brandName);
    const tools = document.createElement("div");
    tools.className = "tools";
    this.pill = langPill();
    this.settingsBtn = roundButton("sliders");
    this.settingsBtn.onclick = () => this.onSettings?.();
    this.helpBtn = roundButton("help");
    this.helpBtn.onclick = () => this.onHelp?.();
    tools.append(this.pill, this.settingsBtn, this.helpBtn);
    this.header.append(brand, tools);

    // ---- the screen
    this.el = document.createElement("div");
    this.el.className = "home";
    this.info = document.createElement("div");
    this.info.className = "modeinfo";
    this.modeName = document.createElement("span");
    this.modeName.className = "name gradtext";
    this.modeShort = document.createElement("p");
    this.info.append(this.modeName, this.modeShort);

    const orb = document.createElement("div");
    orb.className = "orbwrap";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    animator.attach("hero", canvas);
    this.startBtn = document.createElement("button");
    this.startBtn.className = "startorb";
    this.startBtn.type = "button";
    this.startBtn.innerHTML = icon("mic");
    this.startLabel = document.createElement("span");
    this.startBtn.appendChild(this.startLabel);
    this.startBtn.onclick = () => this.onStart?.();
    orb.append(canvas, this.startBtn);

    const offers = document.createElement("div");
    offers.className = "offers";
    // Reading only: the reciter is going through the mushaf in order, so the
    // place they stopped is worth more than a search. Straight to it, with no
    // listening first — they have not said anything yet to be found by.
    this.resumeBtn = document.createElement("button");
    this.resumeBtn.className = "resume";
    this.resumeBtn.type = "button";
    this.resumeBtn.onclick = () => {
      if (this.resumeAt) this.onStart?.(this.resumeAt);
    };
    this.chooseBtn = document.createElement("button");
    this.chooseBtn.className = "choose";
    this.chooseBtn.type = "button";
    this.chooseBtn.onclick = () => this.onChoose?.();
    offers.append(this.resumeBtn, this.chooseBtn);

    this.el.append(this.info, orb, offers);
  }

  /** Re-read every string (a language switch), and redraw the mode line. */
  retitle(mode: Mode, corpus: QuranCorpus): void {
    this.brandName.textContent = t().appTitle;
    this.pill.sync();
    label(this.settingsBtn, t().settings);
    label(this.helpBtn, t().help);
    this.startLabel.textContent = t().startReciting;
    this.chooseBtn.textContent = t().chooseSurah;
    this.setResume(this.resumeAt, corpus);
    this.setMode(mode, false);
  }

  /**
   * The mode's name and its one-line description. On a CHANGE of mode they
   * come in from below and out of focus — the page says, without a word,
   * "this is a different sitting now".
   */
  setMode(mode: Mode, animate = true): void {
    const changed = this.mode !== null && this.mode !== mode;
    this.mode = mode;
    this.modeName.textContent = t().modes[mode];
    this.modeShort.textContent = t().modeShort[mode];
    if (changed && animate && this.info.animate) {
      this.info.animate(
        [
          { opacity: 0, transform: "translateY(10px)", filter: "blur(6px)" },
          { opacity: 1, transform: "none", filter: "blur(0)" },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    }
  }

  /**
   * Offer to pick up where the reciter stopped. Reading passes the ayah; every
   * other mode passes null. An unoffered pill fades and sinks rather than
   * vanishing, so the column does not jump when the mode changes under it.
   */
  setResume(at: AyahRef | null, corpus: QuranCorpus): void {
    this.resumeAt = at;
    if (at) {
      this.resumeBtn.innerHTML = icon("bookmark");
      this.resumeBtn.append(t().resumeFrom(surahName(corpus.surah(at.surah)), formatNumber(at.ayah)));
    }
    offer(this.resumeBtn, at !== null);
  }

  /** Offer the surah index — the modes that begin on a surah the reciter picks. */
  setCanChoose(can: boolean): void {
    offer(this.chooseBtn, can);
  }
}

/** Offered: visible and reachable. Not offered: faded, sunk, and out of the tab order. */
function offer(el: HTMLElement, on: boolean): void {
  el.classList.toggle("offer-off", !on);
  el.tabIndex = on ? 0 : -1;
  el.setAttribute("aria-hidden", String(!on));
}

export function roundButton(name: Parameters<typeof icon>[0], extra = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `roundbtn ${extra}`.trim();
  b.type = "button";
  b.innerHTML = icon(name);
  return b;
}

export function label(el: HTMLElement, text: string): void {
  el.setAttribute("aria-label", text);
  el.title = text;
}
