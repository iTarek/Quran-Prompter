import { formatNumber } from "../lang.js";
import { t } from "../strings.js";
import { label, roundButton } from "./home.js";
import type { Animator } from "./orb.js";
import type { PromptPage } from "./page.js";

/**
 * The reading screen: the page, full-bleed under a fade mask, and over it the
 * least chrome that still orients the reciter —
 *
 *   ×            back to the start (what the reload button did)
 *   HUD capsule  a five-bar wave that moves with the room, the surah, and
 *                «آية ٣ من ٧»
 *   sliders      the settings, reachable without leaving the page — the text
 *                size is the thing most often changed mid-recitation
 *
 * and a hairline under them that fills as the surah is read.
 */
export class ReaderScreen {
  readonly el: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;
  private readonly hudSurah: HTMLSpanElement;
  private readonly hudAyah: HTMLSpanElement;
  private readonly fill: HTMLDivElement;
  private place: { surah: string; ayah: number; of: number } | null = null;
  onClose: (() => void) | null = null;
  onSettings: (() => void) | null = null;

  constructor(page: PromptPage, animator: Animator) {
    this.el = document.createElement("div");
    this.el.className = "layer reader";
    this.el.dataset.hidden = "1";

    const bar = document.createElement("div");
    bar.className = "rbar";
    this.closeBtn = roundButton("close", "x");
    this.closeBtn.onclick = () => this.onClose?.();
    const hud = document.createElement("div");
    hud.className = "hud";
    const mini = document.createElement("canvas");
    mini.setAttribute("aria-hidden", "true");
    animator.attach("mini", mini);
    this.hudSurah = document.createElement("span");
    this.hudSurah.className = "hs";
    this.hudAyah = document.createElement("span");
    this.hudAyah.className = "ha";
    hud.append(mini, this.hudSurah, this.hudAyah);
    this.settingsBtn = roundButton("sliders");
    this.settingsBtn.onclick = () => this.onSettings?.();
    bar.append(this.closeBtn, hud, this.settingsBtn);

    const progress = document.createElement("div");
    progress.className = "progress";
    progress.setAttribute("aria-hidden", "true");
    this.fill = document.createElement("div");
    progress.appendChild(this.fill);

    // The page first, so the chrome paints over it.
    this.el.append(page.el, bar, progress);
    this.retitle();
  }

  show(visible: boolean): void {
    this.el.dataset.hidden = visible ? "0" : "1";
  }

  /** Where the reciter is: the surah's name, and «آية N من M». */
  setPlace(surah: string, ayah: number, of: number): void {
    this.place = { surah, ayah, of };
    this.hudSurah.textContent = surah;
    this.hudAyah.textContent = t().ayahOf(formatNumber(ayah), formatNumber(of));
  }

  /** How much of the surah is behind the reciter, 0…1. */
  setProgress(fraction: number): void {
    this.fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  retitle(): void {
    label(this.closeBtn, t().restart);
    label(this.settingsBtn, t().settings);
    if (this.place) this.setPlace(this.place.surah, this.place.ayah, this.place.of);
  }
}
