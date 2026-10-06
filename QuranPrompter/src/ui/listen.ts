import { formatNumber } from "../lang.js";
import type { Mode } from "../prefs.js";
import { t } from "../strings.js";
import { label, roundButton } from "./home.js";
import type { Animator } from "./orb.js";

/*
 * The words the search is guessing, rising behind the orb — the AlKetab app's
 * `PrompterFloatingWords`, with its numbers. Each word lives FLOAT_LIFE: in
 * focus over the first FLOAT_FOCUS, out over the last FLOAT_FADE, rising
 * throughout. At most MAX_FLOATING at once; past it the oldest go, by then all
 * but faded.
 */
const FLOAT_LIFE = 7000;
const FLOAT_FOCUS = 900;
const FLOAT_FADE = 2200;
const MAX_FLOATING = 20;

/**
 * «نستمع إلى التلاوة» — the full-screen orb while the prompter searches for
 * the reciter, both the first time and every time it has to find them again.
 *
 * **Nothing here says "listening" until the microphone is provably hot.** The
 * orb waits dimmed and the words stay blank until the first chunk of audio
 * arrives; after half a second of that, a spinner says the device is still
 * waking. A lit orb over a microphone that is not open would be a lie.
 *
 * When the place is found, the surah's name comes up out of focus in the
 * middle of the orb — and the page is ALREADY following the reciter
 * underneath. This layer only holds for a moment, then lets go of it.
 *
 * **While it searches, the words it thinks it heard rise behind the orb**
 * (`float`). Decoration — the engine thinking, made visible — not a
 * transcript: a guess may be wrong, and none is ever filtered for being
 * right. The point is a screen that looks alive while the search works.
 */
export class ListenScreen {
  readonly el: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly chipName: HTMLSpanElement;
  private readonly chipExtra: HTMLSpanElement;
  private readonly waiting: HTMLDivElement;
  private readonly foundBox: HTMLDivElement;
  private readonly foundName: HTMLSpanElement;
  private readonly foundSub: HTMLSpanElement;
  private readonly title: HTMLParagraphElement;
  private readonly sub: HTMLParagraphElement;
  private readonly onDevice: HTMLDivElement;
  private spinnerTimer: number | null = null;
  private mode: Mode = "reading";
  private rakah: number | null = null;
  private isFound = false;
  /** The place was chosen by the reciter, not found by listening — see `found`. */
  private isChosen = false;
  private readonly orbWrap: HTMLDivElement;
  /** Behind everything else on the layer — see `float`. */
  private readonly floats: HTMLDivElement;
  /** The words already floated in this search: the guess is re-sent as it grows, and a word floats once. */
  private readonly floated = new Set<number>();
  /** Where the last few rose from, so the next one comes up somewhere else. */
  private recentSpots: { x: number; y: number }[] = [];
  private readonly still = matchMedia("(prefers-reduced-motion: reduce)");
  /** Set by main: the × — back to the start, as a reload would leave it. */
  onClose: (() => void) | null = null;

  constructor(animator: Animator) {
    this.el = document.createElement("div");
    this.el.className = "layer listen";
    this.el.dataset.hidden = "1";
    this.el.dataset.live = "0";

    this.closeBtn = roundButton("close", "lg x");
    this.closeBtn.onclick = () => this.onClose?.();

    const chipRow = document.createElement("div");
    chipRow.className = "modechip-row";
    const chip = document.createElement("span");
    chip.className = "modechip";
    const dot = document.createElement("span");
    dot.className = "dot";
    this.chipName = document.createElement("span");
    this.chipExtra = document.createElement("span");
    this.chipExtra.className = "extra";
    chip.append(dot, this.chipName, this.chipExtra);
    chipRow.appendChild(chip);

    this.floats = document.createElement("div");
    this.floats.className = "floats";
    this.floats.setAttribute("aria-hidden", "true");

    const orb = document.createElement("div");
    orb.className = "orbwrap";
    this.orbWrap = orb;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    animator.attach("listen", canvas);
    this.waiting = document.createElement("div");
    this.waiting.className = "spinner waiting";
    this.waiting.hidden = true;
    this.foundBox = document.createElement("div");
    this.foundBox.className = "found";
    this.foundBox.hidden = true;
    this.foundName = document.createElement("span");
    this.foundName.className = "fname";
    this.foundSub = document.createElement("span");
    this.foundSub.className = "fsub";
    this.foundBox.append(this.foundName, this.foundSub);
    orb.append(canvas, this.waiting, this.foundBox);

    this.title = document.createElement("p");
    this.title.className = "ltitle";
    this.title.setAttribute("aria-live", "polite");
    this.sub = document.createElement("p");
    this.sub.className = "lsub";

    this.onDevice = document.createElement("div");
    this.onDevice.className = "ondevice";

    this.el.append(this.floats, this.closeBtn, chipRow, orb, this.title, this.sub, this.onDevice);
    this.retitle();
  }

  show(visible: boolean): void {
    const rising = visible && !this.visible;
    this.el.dataset.hidden = visible ? "0" : "1";
    if (visible) this.clearFound();
    // A new search: the last one's words went with the orb, and any word may
    // float again.
    if (rising) {
      this.floats.replaceChildren();
      this.floated.clear();
      this.recentSpots = [];
    }
  }

  /**
   * The search's current guess, as words — keyed by their place in the
   * mushaf, drawn in its glyphs. New ones join those rising; only while the
   * orb is up and still searching: once the place is named, the page takes
   * over.
   */
  float(words: readonly { key: number; text: string }[]): void {
    if (!this.visible || this.isFound) return;
    for (const w of words) {
      if (this.floated.has(w.key)) continue;
      this.floated.add(w.key);
      this.spawn(w.text);
    }
    while (this.floats.childElementCount > MAX_FLOATING) this.floats.firstElementChild?.remove();
  }

  /**
   * One word, somewhere on the screen clear of the orb's middle, the words
   * under it and the last few to rise. It comes up out of focus, rises and
   * fades — nearer ones (`depth`) bigger, brighter and faster.
   *
   * Web Animations rather than CSS ones: the stylesheet's reduced-motion rule
   * cuts every CSS animation to nothing, which would flash each word and drop
   * it. With reduced motion it simply fades in and out where it is.
   */
  private spawn(text: string): void {
    const area = this.el.getBoundingClientRect();
    if (!area.width || !area.height) return;
    const share = (r: DOMRect) => ({
      cx: (r.left + r.width / 2 - area.left) / area.width,
      cy: (r.top + r.height / 2 - area.top) / area.height,
    });
    const orb = share(this.orbWrap.getBoundingClientRect());
    const words = this.title.getBoundingClientRect();
    const wordsBottom = (this.sub.getBoundingClientRect().bottom - area.top) / area.height;
    const wordsTop = (words.top - area.top) / area.height;
    const depth = Math.random();
    const size = 24 + 16 * depth;
    let x = 0.5;
    let y = 0.5;
    for (let i = 0; i < 12; i++) {
      x = 0.1 + Math.random() * 0.8;
      y = 0.14 + Math.random() * 0.76;
      const clearOfCentre = Math.abs(x - orb.cx) > 0.22 || Math.abs(y - orb.cy) > 0.08;
      const clearOfWords = y < wordsTop - 0.04 || y > wordsBottom + 0.04;
      const clearOfRecent = this.recentSpots.every((p) => Math.hypot(p.x - x, p.y - y) > 0.2);
      if (clearOfCentre && clearOfWords && clearOfRecent) break;
    }
    this.recentSpots = [...this.recentSpots.slice(-2), { x, y }];

    const word = document.createElement("span");
    word.className = "fw";
    const glyphs = document.createElement("span");
    glyphs.textContent = text;
    word.appendChild(glyphs);
    word.style.fontSize = `${size}px`;
    word.style.color = `rgba(255, 255, 255, ${(0.28 + 0.42 * depth + (Math.random() - 0.5) * 0.08).toFixed(3)})`;
    this.floats.appendChild(word);
    // Its centre, kept far enough in that the whole word stays on screen.
    const half = Math.min(word.offsetWidth / 2 + 16, area.width / 2);
    word.style.left = `${Math.min(Math.max(x * area.width, half), area.width - half)}px`;
    word.style.top = `${y * area.height}px`;

    const focused = FLOAT_FOCUS / FLOAT_LIFE;
    const fading = (FLOAT_LIFE - FLOAT_FADE) / FLOAT_LIFE;
    if (this.still.matches) {
      glyphs.animate(
        [{ opacity: 0 }, { opacity: 1, offset: focused }, { opacity: 1, offset: fading }, { opacity: 0 }],
        { duration: FLOAT_LIFE, fill: "forwards" },
      );
    } else {
      const rise = 50 + 70 * depth;
      word.animate(
        [{ transform: "translate(-50%, -50%) translateY(0)" }, { transform: `translate(-50%, -50%) translateY(${-rise}px)` }],
        { duration: FLOAT_LIFE, easing: "linear", fill: "forwards" },
      );
      glyphs.animate(
        [
          { opacity: 0, filter: "blur(8px)", transform: "scale(0.9)", easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
          { opacity: 1, filter: "blur(0px)", transform: "scale(1)", offset: focused, easing: "linear" },
          { opacity: 1, filter: "blur(0px)", transform: "scale(1)", offset: fading, easing: "ease-in-out" },
          { opacity: 0, filter: "blur(0px)", transform: "scale(1)" },
        ],
        { duration: FLOAT_LIFE, fill: "forwards" },
      );
    }
    window.setTimeout(() => word.remove(), FLOAT_LIFE);
  }

  get visible(): boolean {
    return this.el.dataset.hidden === "0";
  }

  /** The orb lights and the words appear only once audio is provably arriving. */
  setMicLive(live: boolean): void {
    this.el.dataset.live = live ? "1" : "0";
    if (this.spinnerTimer !== null) {
      clearTimeout(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (live) {
      this.waiting.hidden = true;
      return;
    }
    this.spinnerTimer = window.setTimeout(() => {
      this.spinnerTimer = null;
      if (this.el.dataset.live === "0") this.waiting.hidden = false;
    }, 500);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.retitle();
  }

  /** Praying only: which rak‘ah this is, beside the mode's name. */
  setRakah(n: number | null): void {
    this.rakah = n;
    this.retitle();
  }

  /**
   * The place was found: the surah's name, the ayah, «وجدتُ موضعك». The
   * caller decides how long this holds before the layer lets go.
   *
   * `chosen`: the reciter picked it — resume, the index, the next surah —
   * and the same moment plays with «إلى موضعك» under it, since nothing was
   * found by listening.
   */
  found(surahName: string, ayah: number, chosen = false): void {
    this.isFound = true;
    this.isChosen = chosen;
    this.waiting.hidden = true;
    this.foundName.textContent = surahName;
    this.foundSub.textContent = t().foundAyah(formatNumber(ayah));
    // Re-trigger the pop: a second find in the same sitting (praying, the next
    // rak‘ah) must come up out of focus again, not appear already settled.
    this.foundBox.hidden = true;
    void this.foundBox.offsetWidth;
    this.foundBox.hidden = false;
    this.retitle();
  }

  private clearFound(): void {
    if (!this.isFound) return;
    this.isFound = false;
    this.foundBox.hidden = true;
    this.retitle();
  }

  retitle(): void {
    label(this.closeBtn, t().restart);
    this.chipName.textContent = t().modes[this.mode];
    this.chipExtra.textContent = this.mode === "praying" && this.rakah !== null ? `· ${t().rakah(formatNumber(this.rakah))}` : "";
    this.title.textContent = this.isFound ? (this.isChosen ? t().goingTo : t().found) : t().listeningNow;
    // A hard space holds the line's height when there is nothing to say, so
    // the title does not jump up when the found state clears it.
    this.sub.textContent = this.isFound ? " " : this.mode === "praying" ? t().prayingSub : t().listeningSub;
    const dot = document.createElement("span");
    dot.className = "dot";
    this.onDevice.replaceChildren(dot, t().onDevice);
  }
}
