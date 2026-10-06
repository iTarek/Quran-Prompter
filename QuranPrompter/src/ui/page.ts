import { PageIndex, type AyahRef, type QuranCorpus, type WordState, type WordVerdict } from "@alketab/quran-engine";
import { icon } from "../icons.js";
import { arabicDigits, formatNumber, surahName, uiDir } from "../lang.js";
import { t } from "../strings.js";

/**
 * The reading page — the mushaf, as the redesign sets it.
 *
 * The ayahs FLOW: one paragraph per printed page, words running on from ayah
 * to ayah with each ayah's number in a ring after its last word, the way a
 * mushaf is printed. A page band sits between two paragraphs where the printed
 * page turns. Each word's COLOUR is its verdict. The ayahs already recited
 * step back to a third of their brightness, so the eye stays on the one being
 * said, and the line holding the current word parks 42 % from the top — the
 * middle of the band the scroller's fade mask leaves clear.
 */
export class PromptPage {
  /** The scroller. It is also the mask, and the offset parent every word measures from. */
  readonly el: HTMLDivElement;
  private readonly mushaf: HTMLDivElement;
  private corpus: QuranCorpus;
  private surah = 0;
  private chips = new Map<number, HTMLSpanElement>();
  /** Each ayah's own span, by ayah number — what `data-past` dims. */
  private ays: HTMLSpanElement[] = [];
  /** Every ayah numbered BELOW this is marked past. */
  private pastBefore = 1;
  private currentWord = -1;
  /**
   * The word AFTER the cursor, marked `data-lead`: where the reciter most
   * likely is by now. The cursor is the word whose sounds the engine has
   * matched, and that is always behind the voice — 480 ms of audio per step
   * plus the model's own delay. Measured on rahman.wav, a word lit 1.0–1.2 s
   * after the reciter began it, so by then they were already saying the next
   * one, and the page felt a word behind. The lead is a prompt, never a
   * verdict: it says "you are about here", not "you said this right".
   */
  private lead: HTMLSpanElement | null = null;
  private anchoredTop = -1;
  private built = false;
  private readonly pages = new PageIndex();
  private speaking: HTMLSpanElement | null = null;
  /**
   * The Latin readings, indexed by global word, or null when the reciter has
   * not asked for them. Null is not just "hidden": no reading element is
   * built at all, so a surah costs exactly what it cost before the feature.
   */
  private translit: string[] | null = null;
  /** Coalesces refits — see `scheduleFit`. */
  private fitTimer: number | null = null;
  /**
   * Review mode's line in the sand: every word BEFORE this global index has
   * been revealed. The cursor does not visit words one by one — it advances in
   * jumps, several words per audio chunk — so revealing only what it lands on
   * left hidden words sitting behind the current one. A sweep up to the
   * cursor, remembered here so no word is walked twice, keeps the rule simple
   * enough to trust: hidden means still ahead of you.
   */
  private revealedUpTo = -1;
  /**
   * Fired when a word is tapped: surah, ayah, and the word's 1-based position
   * in its ayah, which is how the recitation CDN addresses it. Called INSIDE
   * the tap, so whatever it starts playing is started by a real gesture.
   */
  onWordTapped: ((surah: number, ayah: number, position: number) => void) | null = null;
  /** The reciter choosing to move on at the end of a surah — see `buildTail`. */
  onContinue: ((at: AyahRef) => void) | null = null;
  /** The reciter opening the index from the end of a surah. */
  onChoose: (() => void) | null = null;
  /** The reciter asking to be found again, from the end of a surah. */
  onSearchAgain: (() => void) | null = null;
  /** Whether the end-of-surah offers are built at all — see `setTail`. */
  private tail = false;
  /** How much of the page's foot something sits over — the meaning sheet. See `setReserve`. */
  private reserve = 0;

  constructor(corpus: QuranCorpus) {
    this.corpus = corpus;
    this.el = document.createElement("div");
    this.el.className = "page";
    this.mushaf = document.createElement("div");
    this.mushaf.className = "mushaf";
    this.el.appendChild(this.mushaf);
    this.installTap();
  }

  /**
   * A tap on a word says it aloud — on the Arabic or on its Latin reading.
   * A `click`, not a timer: the browser only fires one for a press that did
   * not become a scroll or a pinch, so no slop or cancel bookkeeping is needed.
   * It used to be a 450 ms hold, which nobody found without being told.
   */
  private installTap(): void {
    this.el.addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement | null)?.closest?.(".chip") as HTMLSpanElement | null;
      const w = chip?.dataset.w;
      if (!chip || w === undefined) return;
      const ref = this.corpus.ref(Number(w));
      // The CDN counts words from one; the corpus counts from zero.
      this.onWordTapped?.(ref.surah, ref.ayah, ref.word + 1);
    });
    // A finger resting on a word must not raise the platform's selection
    // callout over the page. Everywhere else a right click behaves normally.
    this.el.addEventListener("contextmenu", (e) => {
      if ((e.target as HTMLElement | null)?.closest?.(".chip")) e.preventDefault();
    });
  }

  /**
   * Underline the word being said, or clear it. Only one is ever marked: the
   * player stops the previous word before starting the next, and reports it.
   */
  setSpeaking(wordIndex: number | null): void {
    if (this.speaking) this.speaking.classList.remove("speaking");
    this.speaking = wordIndex === null ? null : (this.chips.get(wordIndex) ?? null);
    this.speaking?.classList.add("speaking");
  }

  get mountedSurah(): number {
    return this.surah;
  }

  /**
   * Re-read the strings after a language switch: the surah's title card, the
   * page bands and the end-of-scroll offers carry words; the ayah text is
   * mushaf glyphs and the ayah numbers are always Arabic-Indic. Rewritten
   * where they stand — remounting would work too, and would throw away every
   * verdict colour and the scroll position with them.
   */
  retitle(): void {
    const title = this.mushaf.querySelector<HTMLSpanElement>(".stitle");
    if (title && this.surah > 0) title.textContent = surahName(this.corpus.surah(this.surah));
    for (const band of this.mushaf.querySelectorAll<HTMLDivElement>(".pageband")) {
      const n = Number(band.dataset.page);
      if (Number.isFinite(n)) band.textContent = bandText(n);
    }
    const tail = this.mushaf.querySelector<HTMLDivElement>(".tail");
    if (tail && this.tail && this.surah > 0) this.fillTail(tail, this.surah);
  }

  /** Mount a surah (idempotent). Verdicts are cleared. */
  mount(surah: number): void {
    if (this.surah === surah && this.built) return;
    this.surah = surah;
    this.built = true;
    this.chips.clear();
    // The word it pointed at is about to be thrown away with the rest of the
    // surah; keeping the reference would leave `setSpeaking` clearing a node
    // that is no longer on the page.
    this.speaking = null;
    this.lead = null; // thrown away with the rest of the surah
    this.currentWord = -1;
    this.anchoredTop = -1;
    this.pastBefore = 1;
    const info = this.corpus.surah(surah);
    this.ays = [];
    this.revealedUpTo = info.firstWord;
    const frag = document.createDocumentFragment();

    // The title card and the basmala. Not for الفاتحة — its basmala IS its
    // first ayah, recited and tracked — and no basmala for التوبة, which has
    // none. The basmala is drawn from الفاتحة's own four words: the mushaf
    // face can draw nothing but the corpus's glyphs.
    if (surah !== 1) {
      const head = document.createElement("div");
      head.className = "shead";
      const title = document.createElement("span");
      title.className = "stitle";
      title.textContent = surahName(info);
      head.appendChild(title);
      if (surah !== 9) {
        const bs = document.createElement("span");
        bs.className = "basmala";
        bs.textContent = this.basmala();
        bs.setAttribute("aria-hidden", "true");
        head.appendChild(bs);
      }
      frag.appendChild(head);
    }

    // Ayah ordinals are consecutive, so one lookup and a running index give
    // every page — and each ayah's page is read once instead of twice, since
    // this ayah's is the one the previous pass already fetched as "next".
    const firstOrdinal = this.corpus.ayahOrdinal(surah, 1);
    let thisPage = this.pages.page(firstOrdinal);
    let para = newPara();
    for (let a = 1; a <= info.ayahCount; a++) {
      const ay = document.createElement("span");
      ay.className = "ay";
      const first = this.corpus.ayahFirstWord(surah, a);
      const count = this.corpus.ayahWordCount(surah, a);
      for (let w = 0; w < count; w++) {
        const g = first + w;
        const chip = document.createElement("span");
        chip.className = "chip";
        // Mushaf glyphs render; the plain text is what a screen reader (or a
        // copy) should get, since private-use codepoints mean nothing outside
        // the font.
        chip.textContent = this.corpus.displayWord(g);
        chip.setAttribute("aria-label", this.corpus.plainWord(g));
        chip.dataset.w = String(g);
        if (this.translit) chip.appendChild(this.readingFor(g));
        // Review mode: an ayah's opening word is the real test of memory — the
        // one produced from nothing — so it is the one current word that stays
        // hidden until said. Marked here, judged in the stylesheet.
        if (w === 0) chip.dataset.ayahstart = "1";
        this.chips.set(g, chip);
        // Real spaces between words, as the text is set in the mushaf — the
        // face has its own space, and the line breaks where a space allows.
        ay.append(chip, " ");
      }
      const num = document.createElement("span");
      num.className = "am";
      num.textContent = arabicDigits(a);
      num.setAttribute("aria-label", formatNumber(a));
      ay.appendChild(num);
      this.ays[a] = ay;
      para.append(ay, " ");

      // The printed page turns here — the iOS prompter's end-of-page band.
      //
      // **Only where the page ACTUALLY turns**, which is why the next ayah's
      // page decides it, and why the surah's last ayah never gets one: the
      // layout is a single surah, so nothing here knows whether the page runs
      // on into the next, and a band claiming a page ended when it did not is
      // worse than a missing one.
      const nextPage = a < info.ayahCount ? this.pages.page(firstOrdinal + a) : null;
      if (thisPage !== null && nextPage !== null && nextPage !== thisPage) {
        frag.appendChild(para);
        const band = document.createElement("div");
        band.className = "pageband";
        // The number is kept on the element, not just in the text: the word
        // and the digits both change with the language, and `retitle()`
        // rewrites them in place rather than rebuilding the surah.
        band.dataset.page = String(thisPage);
        band.textContent = bandText(thisPage);
        frag.appendChild(band);
        para = newPara();
      }
      thisPage = nextPage;
    }
    frag.appendChild(para);

    // The end of the scroll. Always there, so the last line always has the
    // room below it to park; filled only in the modes that lock to a surah.
    const tail = document.createElement("div");
    tail.className = "tail";
    if (this.tail) this.fillTail(tail, surah);
    frag.appendChild(tail);

    this.mushaf.replaceChildren(frag);
    this.el.scrollTop = 0;
    // Immediate, not scheduled: a fit that waits shows every over-wide reading
    // for a moment first, and the surah has only just been built.
    if (this.fitTimer !== null) {
      clearTimeout(this.fitTimer);
      this.fitTimer = null;
    }
    this.fitTranslit();
  }

  /** الفاتحة's first ayah, in mushaf glyphs — the basmala over every other surah. */
  private basmala(): string {
    const first = this.corpus.ayahFirstWord(1, 1);
    const words: string[] = [];
    for (let w = 0; w < this.corpus.ayahWordCount(1, 1); w++) words.push(this.corpus.displayWord(first + w));
    return words.join(" ");
  }

  /** Remove every mark (a new run over the same surah). */
  clearMarks(): void {
    for (const chip of this.chips.values()) {
      delete chip.dataset.state;
      delete chip.dataset.current;
      // A new run starts with everything hidden again; a word revealed in the
      // last one was earned in the last one.
      delete chip.dataset.seen;
    }
    this.setLead(null);
    this.setPastBefore(1);
    this.revealedUpTo = this.surah > 0 ? this.corpus.surah(this.surah).firstWord : -1;
    this.currentWord = -1;
    this.anchoredTop = -1;
  }

  applyVerdicts(changes: WordVerdict[]): void {
    for (const v of changes) {
      const chip = this.chips.get(v.wordIndex);
      if (!chip) continue;
      chip.dataset.state = v.state satisfies WordState;
      // Review mode keeps a word revealed once the engine has judged it —
      // right, wrong, or passed over. `pending` is not a judgement yet, so it
      // earns nothing here; the CURRENT word is shown by the stylesheet while
      // the cursor is on it, and this mark is what keeps it visible after the
      // cursor moves along.
      if (v.state !== "pending") chip.dataset.seen = "1";
    }
  }

  /**
   * Hide every word until it is recited — the memorizing sitting.
   *
   * The glyph is made TRANSPARENT rather than removed, so a hidden word keeps
   * its exact width: the ayah still shows how long it is and how many words
   * are in it, and revealing one moves nothing else on the page.
   */
  setHidden(hidden: boolean): void {
    this.el.classList.toggle("hidewords", hidden);
  }

  setCurrent(wordIndex: number): void {
    if (wordIndex === this.currentWord) return;
    const prev = this.chips.get(this.currentWord);
    if (prev) {
      delete prev.dataset.current;
      // Review mode: a word the cursor has MOVED PAST was recited — its
      // judgement just has not landed yet. It stays on screen in pending's
      // purple until it does; sliding back behind the underline made words
      // vanish in front of the reciter mid-ayah. This is also what finally
      // reveals an ayah's opening word: hidden while awaited, shown once the
      // cursor has gone through it.
      prev.dataset.seen = "1";
    }
    this.currentWord = wordIndex;
    const chip = this.chips.get(wordIndex);
    // The next word of THIS surah; past its last word there is none to prompt.
    this.setLead(this.chips.get(wordIndex + 1) ?? null);
    if (!chip) return;
    chip.dataset.current = "1";
    // Everything BEHIND the cursor is open — see `revealedUpTo`.
    for (let g = Math.max(this.revealedUpTo, 0); g < wordIndex; g++) {
      const behind = this.chips.get(g);
      if (behind) behind.dataset.seen = "1";
    }
    this.revealedUpTo = Math.max(this.revealedUpTo, wordIndex);
    // Having the turn shows a word — except an ayah's opener, which is the
    // memory being tested and waits to be said.
    if (chip.dataset.ayahstart !== "1") chip.dataset.seen = "1";
    this.setPastBefore(this.corpus.ref(wordIndex).ayah);
    this.follow(chip, true);
  }

  private setLead(chip: HTMLSpanElement | null): void {
    if (chip === this.lead) return;
    if (this.lead) delete this.lead.dataset.lead;
    this.lead = chip;
    if (chip) chip.dataset.lead = "1";
  }

  /**
   * Dim every ayah before `ayah`, and only those. The cursor can move BACK —
   * a reciter repeats an ayah — so the change is applied in whichever
   * direction it went, over just the ayahs between the old line and the new.
   */
  private setPastBefore(ayah: number): void {
    const from = Math.min(this.pastBefore, ayah);
    const to = Math.max(this.pastBefore, ayah);
    for (let a = from; a < to; a++) {
      const el = this.ays[a];
      if (!el) continue;
      if (a < ayah) el.dataset.past = "1";
      else delete el.dataset.past;
    }
    this.pastBefore = ayah;
  }

  /**
   * What to do now the surah has ended — the start screen's own three, offered
   * again where the surah runs out. The engine rolls into the next surah by
   * itself when the last ayah is RECITED; this is for the reciter who has read
   * to the end with their eyes and wants to move on without saying it.
   *
   * An-Nas has no next, so it offers only the other two.
   */
  private fillTail(tail: HTMLDivElement, surah: number): void {
    // The mushaf is RTL whatever the language; these are interface words, and
    // an English label inside an RTL box puts its ayah number on the wrong end.
    tail.dir = uiDir();
    const listen = document.createElement("button");
    listen.className = "cta";
    listen.type = "button";
    listen.textContent = t().startReciting;
    listen.onclick = () => this.onSearchAgain?.();
    tail.replaceChildren(listen);

    const next = surah + 1;
    if (next <= 114) {
      // The start screen's resume pill, and its words — «ابدأ من X آية ١». At
      // the end of a surah the place to pick up IS the next one, and pressing
      // it makes that the kept place too (`host.goTo`).
      const go = document.createElement("button");
      go.className = "resume";
      go.type = "button";
      go.innerHTML = icon("bookmark");
      go.append(t().resumeFrom(surahName(this.corpus.surah(next)), formatNumber(1)));
      go.onclick = () => this.onContinue?.({ surah: next, ayah: 1 });
      tail.appendChild(go);
    }
    const choose = document.createElement("button");
    choose.className = "choose";
    choose.type = "button";
    choose.textContent = t().chooseSurah;
    choose.onclick = () => this.onChoose?.();
    tail.appendChild(choose);
  }

  /**
   * Whether the end of a surah offers a way on. Only the modes that LOCK to
   * one surah need it — the others follow the reciter wherever they go, so
   * there is nothing to be stuck at the end of.
   */
  setTail(show: boolean): void {
    if (show === this.tail) return;
    this.tail = show;
    const tail = this.mushaf.querySelector<HTMLDivElement>(".tail");
    if (!tail) return;
    if (show && this.surah > 0) this.fillTail(tail, this.surah);
    else tail.replaceChildren();
  }

  /**
   * One word's Latin reading, sized to fit by `fitTranslit`. Two spans: the
   * outer one is the room under the word, at the full reading size; the inner
   * one is the capsule and its text, and it is what shrinks.
   */
  private readingFor(g: number): HTMLSpanElement {
    const tr = document.createElement("span");
    tr.className = "tr";
    const text = document.createElement("span");
    text.textContent = this.translit?.[g] ?? "";
    tr.appendChild(text);
    // It is a reading aid for the eye, and the word already carries itself
    // for a screen reader; announcing both would read every ayah twice.
    tr.setAttribute("aria-hidden", "true");
    return tr;
  }

  /**
   * Show the Latin reading under every word, or take it away.
   *
   * Passing null REMOVES the elements rather than hiding them: a surah is up
   * to 6,000 words, and a setting most reciters never turn on should not leave
   * 6,000 spans on the page for the browser to lay out.
   */
  setTranslit(words: string[] | null): void {
    if (words === this.translit) return;
    this.translit = words;
    this.el.classList.toggle("translit", words !== null);
    for (const [g, chip] of this.chips) {
      const tr = chip.querySelector<HTMLSpanElement>(".tr");
      if (!words) tr?.remove();
      else if (tr) tr.firstElementChild!.textContent = words[g] ?? "";
      else chip.appendChild(this.readingFor(g));
    }
    this.fitTranslit();
  }

  /**
   * Shrink every reading that is wider than the word it sits under, so a
   * reading can never be broader than its own word — the page is a mushaf and
   * the Arabic decides where the lines break, not the Latin under it.
   *
   * Each pass reads EVERY width before writing a single size: reading a width
   * straight after setting a size costs a layout each time, and 6,000 of those
   * is a frozen page; batched, it is two.
   */
  private fitTranslit(): void {
    if (!this.translit) return;
    const trs = [...this.mushaf.querySelectorAll<HTMLSpanElement>(".tr")];
    if (!trs.length) return;
    for (const tr of trs) tr.style.removeProperty("--tr-fit"); // back to base before measuring
    // Read EVERY width before writing a single size: a read straight after a
    // write costs a layout each time, and 6,000 of those is a frozen page.
    const sizes = trs.map((tr) => {
      const capsule = tr.firstElementChild as HTMLElement | null;
      // The reading's own box: the word's width plus the little room either
      // side the stylesheet gives it. Against it, the CAPSULE's width — it is
      // centred, so it spills out of both sides at once, and `scrollWidth`
      // would only count the half on the right.
      return { room: tr.clientWidth, needs: capsule?.offsetWidth ?? 0, border: capsule ? capsule.offsetWidth - capsule.clientWidth : 0 };
    });
    for (let i = 0; i < trs.length; i++) {
      const { room, needs, border } = sizes[i];
      // A rounded integer: one pixel over is not overflow.
      if (room <= 0 || needs <= room + 1) continue;
      // The text and its padding scale with the fit; the capsule's border
      // does not. So the border comes out of both sides of the ratio, and ONE
      // pass lands every capsule — a plain room ÷ needs left the border's
      // share unshrunk and took three passes, three layouts of the whole
      // surah, to converge on the same sizes. Measured over all 114 surahs at
      // 320-1200 px and 80-220 % text: 77,433 readings, none over after one.
      // What the fit is a ratio OF — the reading's share of the word's size,
      // `--tr-size` — stays the stylesheet's business.
      trs[i].style.setProperty("--tr-fit", ((room - border) / (needs - border)).toFixed(3));
    }
  }

  /**
   * Refit once the size has stopped changing.
   *
   * A fit is ~400 ms over البقرة on a phone-speed CPU, and `resize` fires
   * continuously while a window is dragged. Re-parking the scroll is cheap and
   * must stay immediate; only the fit waits for the dust to settle.
   */
  private scheduleFit(): void {
    if (!this.translit) return;
    if (this.fitTimer !== null) clearTimeout(this.fitTimer);
    this.fitTimer = window.setTimeout(() => {
      this.fitTimer = null;
      this.fitTranslit();
    }, 120);
  }

  /**
   * Something covers the foot of the page — the meaning sheet, `px` tall, or
   * nothing at 0. The current line is parked clear above it (`follow`), and
   * re-parked now, since opening the sheet may have just covered it.
   */
  setReserve(px: number): void {
    if (Math.abs(px - this.reserve) < 1) return;
    const chip = this.chips.get(this.currentWord);
    const before = chip ? this.parkAt(chip) : 0;
    this.reserve = px;
    // Only if the line's place actually moves. The folded sheet changes height
    // with nearly every ayah, and the line parks at 42 % either way; scrolling
    // on each of those snapped back a reciter who had scrolled to look.
    if (!chip || Math.abs(this.parkAt(chip) - before) < 1) return;
    this.anchoredTop = -1;
    this.follow(chip, true);
  }

  /** Re-park after a size change (font multiplier, rotation). */
  repark(): void {
    const chip = this.chips.get(this.currentWord);
    this.anchoredTop = -1;
    // The readings were fitted against the old width; a rotation or a new font
    // size changes what fits.
    this.scheduleFit();
    if (chip) this.follow(chip, false);
  }

  /**
   * Park the current word's LINE 42 % down — inside the band the fade mask
   * leaves fully clear (24 %–72 %). Only when the line changes: the page
   * holds still while the reciter reads along a line.
   *
   * With the meaning sheet over the foot of the page (`reserve`), the line
   * parks higher if it must, so its bottom — and a capsule under it — stays
   * above the sheet with room to spare. Folded, the sheet sits in the band
   * the mask already fades and 42 % stands; opened, the line rises, never
   * above the 24 % where the mask turns clear.
   */
  private follow(chip: HTMLElement, animated: boolean): void {
    const lineTop = chip.offsetTop;
    if (lineTop === this.anchoredTop) return;
    this.anchoredTop = lineTop;
    const target = Math.max(0, lineTop - this.parkAt(chip));
    this.el.scrollTo({ top: target, behavior: animated ? "smooth" : "auto" });
  }

  /** How far down the page the current word's line parks, in px — see `follow`. */
  private parkAt(chip: HTMLElement): number {
    const h = this.el.clientHeight;
    const clear = h - this.reserve - chip.offsetHeight * 1.6 - 12;
    return Math.max(h * 0.24, Math.min(h * 0.42, clear));
  }
}

function newPara(): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "pg";
  return p;
}

/** «صفحة ٢» / "Page 2" — the word and the digits both follow the language. */
function bandText(page: number): string {
  return `${t().page} ${formatNumber(page)}`;
}
