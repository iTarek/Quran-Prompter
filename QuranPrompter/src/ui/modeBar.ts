import { icon } from "../icons.js";
import { MODES, type Prefs } from "../prefs.js";
import { t } from "../strings.js";

/**
 * The four prompter modes, as a glass tab bar at the foot of the start screen.
 * A lit plate sits under the chosen one and SLIDES to the next when the choice
 * changes, overshooting a touch, so the change is felt as well as seen.
 *
 * **Changing it restarts the sitting.** The modes differ in what the engine
 * does with silence, with a finished surah and with another surah entirely, so
 * carrying a half-tracked run across a change would leave the reciter in a
 * state neither mode describes. The host resets and the start screen comes
 * back, which is also what re-arms the wake lock on the next press.
 */
export class ModeBar {
  readonly el: HTMLElement;
  private readonly tabs: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly labels: HTMLSpanElement[];
  private readonly prefs: Prefs;
  /** Set by main: the mode changed, so the sitting starts again. */
  onChange: (() => void) | null = null;

  constructor(prefs: Prefs) {
    this.prefs = prefs;
    this.el = document.createElement("nav");
    this.el.className = "tabsnav";
    this.tabs = document.createElement("div");
    this.tabs.className = "tabs";
    this.tabs.setAttribute("role", "radiogroup");
    const plate = document.createElement("span");
    plate.className = "plate";
    plate.setAttribute("aria-hidden", "true");
    this.tabs.appendChild(plate);
    this.labels = [];
    this.buttons = MODES.map((m) => {
      const b = document.createElement("button");
      b.className = "tab";
      b.type = "button";
      b.setAttribute("role", "radio");
      const ic = document.createElement("span");
      ic.className = "ic";
      ic.innerHTML = icon(m);
      const lb = document.createElement("span");
      lb.className = "lb";
      this.labels.push(lb);
      b.append(ic, lb);
      b.onclick = () => {
        if (prefs.mode === m) return;
        prefs.mode = m;
        this.onChange?.();
      };
      this.tabs.appendChild(b);
      return b;
    });
    this.el.appendChild(this.tabs);
    this.retitle();
  }

  /** Re-read the strings, and move the plate to the mode that is on. */
  retitle(): void {
    this.tabs.setAttribute("aria-label", t().modeTitle);
    MODES.forEach((m, i) => {
      this.labels[i].textContent = t().modeTab[m];
      const on = m === this.prefs.mode;
      this.buttons[i].setAttribute("aria-checked", String(on));
      this.buttons[i].setAttribute("aria-label", t().modes[m]);
      if (on) this.tabs.style.setProperty("--i", String(i));
    });
  }
}
