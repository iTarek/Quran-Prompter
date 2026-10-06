import type { AyahRef } from "@alketab/quran-engine";
import type { Phase } from "../host.js";
import { icon } from "../icons.js";
import { arabicDigits, formatNumber, lang, uiDir } from "../lang.js";
import { parseMeaning, type MeaningAyah, type MeaningEntry, type MeaningFile } from "../meaning.js";
import { t } from "../strings.js";
import { label } from "./home.js";

/**
 * «افهم ما تتلو» — the meaning of the ayah being recited, in a sheet at the
 * foot of the reading screen, changing as the engine moves on.
 *
 * **An iOS sheet with two detents**, not a dialog: the page stays live and in
 * reach behind it. Collapsed it is a grabber, the ayah's number in the
 * mushaf's own ring, three lines of the meaning and the credit — no taller
 * than the band the page's fade mask already dims, so it crowds nothing the
 * reciter reads. Whatever it covers, the page parks the current line clear
 * above it (`PromptPage.setReserve`).
 *
 * **The line and the arrow do different things** (Tarek, 2026-10-05):
 *
 *   the line (grabber)  HIDES the sheet — it slides down until only a strip
 *                       holding the line is left at the foot of the screen —
 *                       and shows it again. Tap, or swipe down / up.
 *   the arrow row       opens it to the whole meaning and its footnotes, and
 *                       folds it back. Tap, or swipe up / down.
 *
 * Hidden stays hidden as the ayahs change and through a return to listening —
 * the reciter put it away on purpose — until they tap the line again, or the
 * app is next opened.
 *
 * **It follows the engine, not the page.** The host's own `phase`, `mounted`
 * and `cursor` arrive here as they arrive at the page, so it says nothing
 * while the engine is still searching — the ayah is not known until `located`
 * — and it is gone the moment the run returns to listening.
 *
 * **QuranEnc's text, untouched.** The translation is rendered as runs of its
 * own characters (`parseMeaning`): a footnote marker stays exactly where it
 * stood, `[2]` and all, and becomes a button that opens the note, verbatim.
 * A note no marker points at gets a «حاشية» button after the text rather than
 * being lost. Every meaning shown carries its credit: the translator and the
 * source — «موسوعة القرآن» in Arabic, "QuranEnc" in English, as Tarek asked;
 * plain text, not a link, so a stray tap in prayer opens nothing. No version
 * here, also his call: the About page lists every translator WITH its version
 * and names "QuranEnc.com" in full, with the link.
 */
export class MeaningSheet {
  readonly el: HTMLElement;
  /** The line: hides the sheet and shows it again. */
  private readonly grab: HTMLButtonElement;
  /** Everything under the line — what is put away when the sheet is hidden. */
  private readonly body: HTMLDivElement;
  /** The arrow row: opens the sheet to the whole meaning, and folds it back. */
  private readonly head: HTMLButtonElement;
  private readonly ring: HTMLSpanElement;
  private readonly langName: HTMLSpanElement;
  private readonly scroller: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly extra: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private readonly noteText: HTMLParagraphElement;
  private readonly noteClose: HTMLButtonElement;
  private readonly credit: HTMLDivElement;
  private file: MeaningFile | null = null;
  private entry: MeaningEntry | null = null;
  /** `prefs.showMeaning`: a translation is picked, and this is not review mode. */
  private enabled = false;
  /** The host is in its reading phase — the engine has located the reciter. */
  private reading = false;
  private at: AyahRef | null = null;
  /** What is on screen now, so a cursor event inside the same ayah costs nothing. */
  private shown = "";
  private open = false;
  /** Put away by the line, all but the line itself. */
  private tucked = false;
  private lastHeight = -1;
  /** The height it covers at the foot of the page, 0 when hidden — for `PromptPage.setReserve`. */
  onHeight: ((px: number) => void) | null = null;

  constructor() {
    this.el = document.createElement("section");
    this.el.className = "msheet";
    this.el.dataset.hidden = "1";
    this.el.dataset.open = "0";
    this.el.dataset.tucked = "0";

    // The line: hides the sheet, and shows it again.
    this.grab = document.createElement("button");
    this.grab.type = "button";
    this.grab.className = "mgrab";
    const line = document.createElement("span");
    line.className = "grabber";
    line.setAttribute("aria-hidden", "true");
    this.grab.appendChild(line);
    this.grab.onclick = () => this.setTucked(!this.tucked);
    installSwipe(this.grab, (up) => this.setTucked(!up));

    // The arrow row: opens the sheet to the whole meaning, and folds it back.
    this.head = document.createElement("button");
    this.head.type = "button";
    this.head.className = "mhead";
    const row = document.createElement("span");
    row.className = "mrow";
    this.ring = document.createElement("span");
    this.ring.className = "mring";
    this.langName = document.createElement("span");
    this.langName.className = "mlang";
    const chev = document.createElement("span");
    chev.className = "mchev";
    chev.innerHTML = icon("chevron");
    row.append(this.ring, this.langName, chev);
    this.head.appendChild(row);
    this.head.onclick = () => this.setOpen(!this.open);
    installSwipe(this.head, (up) => this.setOpen(up));

    this.scroller = document.createElement("div");
    this.scroller.className = "mscroll";
    this.text = document.createElement("p");
    this.text.className = "mtext";
    // A tap on the folded text unfolds it; a marker inside it opens its note.
    this.text.addEventListener("click", (e) => {
      const fn = (e.target as HTMLElement | null)?.closest?.<HTMLButtonElement>(".fn");
      if (fn) return;
      if (!this.open) this.setOpen(true);
    });
    this.extra = document.createElement("div");
    this.extra.className = "mextra";
    this.note = document.createElement("div");
    this.note.className = "mnote";
    this.note.hidden = true;
    this.noteText = document.createElement("p");
    this.noteClose = document.createElement("button");
    this.noteClose.type = "button";
    this.noteClose.className = "mnoteclose";
    this.noteClose.innerHTML = icon("close");
    this.noteClose.onclick = () => this.closeNote();
    this.note.append(this.noteClose, this.noteText);
    this.scroller.append(this.text, this.extra, this.note);

    this.credit = document.createElement("div");
    this.credit.className = "mcredit";

    this.body = document.createElement("div");
    this.body.className = "mbody";
    this.body.append(this.head, this.scroller, this.credit);
    this.el.append(this.grab, this.body);
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.report()).observe(this.el);
    this.retitle();
  }

  // ---- what the host says, as it says it to the page ----------------------

  phase(p: Phase): void {
    this.reading = p.kind === "reading";
    // Back to listening is a new search: the ayah it was on is not where the
    // reciter is any more, and the next `located` will say where they are.
    if (!this.reading) this.at = null;
    this.render();
  }

  mounted(surah: number, ayah: number): void {
    this.at = { surah, ayah };
    this.render();
  }

  cursor(surah: number, ayah: number): void {
    if (this.at?.surah === surah && this.at.ayah === ayah) return;
    this.at = { surah, ayah };
    this.render();
  }

  // ---- what the reciter chose ------------------------------------------------

  setFile(file: MeaningFile | null, entry: MeaningEntry | null): void {
    if (file === this.file && entry === this.entry) return;
    this.file = file;
    this.entry = entry;
    this.shown = "";
    this.render();
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.render();
  }

  get visible(): boolean {
    return this.el.dataset.hidden === "0";
  }

  retitle(): void {
    this.el.setAttribute("aria-label", this.at ? t().meaningOf(formatNumber(this.at.ayah)) : t().meaning);
    label(this.grab, this.tucked ? t().meaningShow : t().meaningHide);
    this.grab.setAttribute("aria-expanded", String(!this.tucked));
    label(this.head, this.open ? t().meaningCollapse : t().meaningExpand);
    label(this.noteClose, t().meaningCloseNote);
    for (const b of this.extra.querySelectorAll("button")) b.textContent = t().meaningNote;
    this.writeCredit();
    this.credit.dir = uiDir();
  }

  // ---- drawing ----------------------------------------------------------------

  private render(): void {
    const ayah = this.at && this.file ? this.file.ayahs[`${this.at.surah}:${this.at.ayah}`] : undefined;
    const show = this.enabled && this.reading && ayah !== undefined;
    this.el.dataset.hidden = show ? "0" : "1";
    if (show && this.at && this.file && ayah) {
      const key = `${this.file.key}@${this.file.version}|${this.at.surah}:${this.at.ayah}`;
      if (key !== this.shown) {
        this.shown = key;
        this.fill(ayah, this.at.ayah);
      }
    }
    this.report();
  }

  private fill(ayah: MeaningAyah, n: number): void {
    const file = this.file!;
    const { pieces, notes, unmarked } = parseMeaning(ayah);
    const nodes = pieces.map((p) => {
      if (p.note === undefined) return document.createTextNode(p.text);
      // The marker as it stands in the text — `[2]`, verbatim — made a button.
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fn";
      b.textContent = p.text;
      const note = notes[p.note];
      b.onclick = () => this.openNote(note.text, b);
      return b;
    });
    this.text.replaceChildren(...nodes);
    this.text.dir = file.dir;
    this.text.lang = file.language;
    this.extra.replaceChildren(
      ...unmarked.map((i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "fn more";
        b.textContent = t().meaningNote;
        b.onclick = () => this.openNote(notes[i].text, b);
        return b;
      }),
    );
    this.closeNote();
    // The ayah's number in the ring the page draws it in: Arabic-Indic in both
    // languages, because it is the mushaf's numbering, not the interface's.
    this.ring.textContent = arabicDigits(n);
    this.langName.textContent = this.entry?.native ?? file.language;
    this.note.dir = file.dir;
    this.note.lang = file.language;
    this.scroller.scrollTop = 0;
    this.retitle();
    // The new meaning settles in, so the change of ayah is seen, not just read.
    this.scroller.animate?.([{ opacity: 0.25 }, { opacity: 1 }], { duration: 380, easing: "ease-out" });
  }

  /** «مركز نور إنترناشونال · موسوعة القرآن» — on every meaning shown. */
  private writeCredit(): void {
    const who = this.entry ? this.entry.translator[lang()] : this.file?.title;
    this.credit.textContent = who ? `${who} · ${t().meaningSourceName}` : "";
  }

  private openNote(text: string, from: HTMLButtonElement): void {
    for (const b of this.el.querySelectorAll(".fn[aria-pressed]")) b.removeAttribute("aria-pressed");
    from.setAttribute("aria-pressed", "true");
    this.noteText.textContent = text;
    this.note.hidden = false;
    this.setOpen(true);
    this.note.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  private closeNote(): void {
    this.note.hidden = true;
    this.noteText.textContent = "";
    for (const b of this.el.querySelectorAll(".fn[aria-pressed]")) b.removeAttribute("aria-pressed");
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.el.dataset.open = open ? "1" : "0";
    this.head.setAttribute("aria-expanded", String(open));
    if (!open) {
      this.closeNote();
      this.scroller.scrollTop = 0;
    }
    this.retitle();
    this.report();
  }

  private setTucked(tucked: boolean): void {
    if (tucked === this.tucked) return;
    this.tucked = tucked;
    this.el.dataset.tucked = tucked ? "1" : "0";
    // Below the screen, so out of reach too: no focus and no screen reader in
    // what is put away. The line stays outside it, to bring it back.
    this.body.toggleAttribute("inert", tucked);
    this.retitle();
    this.report();
  }

  private report(): void {
    // Put away, it covers only the strip the line sits in.
    const h = !this.visible ? 0 : this.tucked ? this.grab.offsetHeight : this.el.offsetHeight;
    if (h === this.lastHeight) return;
    this.lastHeight = h;
    this.onHeight?.(h);
  }
}

/**
 * A vertical swipe on `el` calls `swiped(up)`, the way a sheet's grabber
 * does. A click that follows the swipe is swallowed, or it would undo what the
 * swipe just did — but only one belonging to the SAME press: a touch swipe
 * usually fires no click at all, and a flag left standing then ate the
 * reciter's next real tap. Every new press clears it.
 */
function installSwipe(el: HTMLElement, swiped: (up: boolean) => void): void {
  let y0: number | null = null;
  let swallow = false;
  el.addEventListener("pointerdown", (e) => {
    y0 = e.clientY;
    swallow = false;
  });
  el.addEventListener("pointercancel", () => (y0 = null));
  el.addEventListener("pointerup", (e) => {
    if (y0 === null) return;
    const dy = e.clientY - y0;
    y0 = null;
    if (Math.abs(dy) < 24) return;
    swallow = true;
    swiped(dy < 0);
  });
  el.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
