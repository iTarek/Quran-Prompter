import { PageIndex, type QuranCorpus } from "@alketab/quran-engine";
import { icon } from "../icons.js";
import { arabicDigits, formatNumber, lang, uiDir } from "../lang.js";
import type { MeaningEntry, Meanings } from "../meaning.js";
import { BACKDROPS, PALETTES, type Prefs } from "../prefs.js";
import { t } from "../strings.js";
import { BACKDROP_COLOR, PALETTE_STOPS } from "../theme.js";
import { langPill } from "./home.js";

/** A dialog that removes itself — and its subscriptions — when it closes. */
export type Sheet = HTMLDialogElement;

/**
 * A bottom sheet: grabber, title, «تم». A real `<dialog>`, so focus is held
 * inside it, Esc closes it, and it sits in the top layer over everything.
 * Built on open and thrown away on close: a sheet built at load would carry
 * the language that was current then, and hold subscriptions for a sheet most
 * sittings never open.
 */
function sheet(className: string, title: string, dispose: () => void): { dialog: Sheet; head: HTMLDivElement } {
  const dialog = document.createElement("dialog");
  dialog.className = `sheet ${className}`;
  dialog.dir = uiDir();
  const head = document.createElement("div");
  head.className = "shd";
  const h = document.createElement("h3");
  h.textContent = title;
  const done = document.createElement("button");
  done.className = "donebtn";
  done.type = "button";
  done.textContent = t().done;
  done.onclick = () => dialog.close();
  head.append(h, done);
  // A click that lands on the dialog itself is on the backdrop around it — but
  // only if the press STARTED there too. A mouse selecting text in the search
  // box and let go outside the sheet also produces a click on the dialog (the
  // nearest element holding both ends), and closed the index mid-search.
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", (e) => (pressedBackdrop = e.target === dialog));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && pressedBackdrop) dialog.close();
  });
  dialog.addEventListener(
    "close",
    () => {
      dispose();
      dialog.remove();
    },
    { once: true },
  );
  return { dialog, head };
}

function grabber(): HTMLSpanElement {
  const g = document.createElement("span");
  g.className = "grabber";
  g.setAttribute("aria-hidden", "true");
  return g;
}

function group(title: string, value?: HTMLElement): HTMLDivElement {
  const g = document.createElement("div");
  g.className = "sgroup";
  const row = document.createElement("div");
  row.className = "slabel";
  const name = document.createElement("span");
  name.textContent = title;
  row.appendChild(name);
  if (value) row.appendChild(value);
  g.appendChild(row);
  return g;
}

function foot(text: string): HTMLSpanElement {
  const f = document.createElement("span");
  f.className = "sfoot";
  f.textContent = text;
  return f;
}

/**
 * «إعدادات الملقّن»: text size with a live preview, the highlight palette, the
 * background, the meaning, the Latin reading, the mistake sound, and the
 * language.
 */
export function settingsSheet(corpus: QuranCorpus, prefs: Prefs, meanings: Meanings): Sheet {
  const offs: (() => void)[] = [];
  const { dialog, head } = sheet("settings", t().settings, () => offs.forEach((off) => off()));
  const body = document.createElement("div");
  body.className = "settings-body";

  // ---- text size
  const sizeValue = document.createElement("span");
  const size = group(t().fontSize, sizeValue);
  const preview = document.createElement("div");
  preview.className = "preview";
  preview.setAttribute("aria-hidden", "true");
  // The preview's first word is lit the way a recited word is, so moving the
  // slider shows the palette at the size the reciter is choosing.
  const first = corpus.ayahFirstWord(1, 1);
  const line = document.createElement("span");
  for (let w = 0; w < 2; w++) {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (w === 0) chip.dataset.state = "ok";
    chip.textContent = corpus.displayWord(first + w);
    line.appendChild(chip);
  }
  preview.appendChild(line);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.8";
  slider.max = "2.2";
  slider.step = "0.1";
  slider.setAttribute("aria-label", t().fontSize);
  slider.oninput = () => (prefs.fontMulti = Number(slider.value));
  const syncSize = () => {
    slider.value = String(prefs.fontMulti);
    sizeValue.textContent = `${formatNumber(Math.round(prefs.fontMulti * 100))}${lang() === "ar" ? "٪" : "%"}`;
    // The multiplier on a fixed base, capped — the sheet's own layout must not
    // grow with the slider it holds.
    preview.style.fontSize = `${Math.min(64, Math.round(36 * prefs.fontMulti))}px`;
  };
  size.append(preview, slider, foot(t().fontFooter));

  // ---- highlight palette
  const pal = group(t().highlight);
  const palGrid = document.createElement("div");
  palGrid.className = "pickgrid";
  const palButtons = PALETTES.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pal";
    const stops = PALETTE_STOPS[p];
    // Each chip rings in ITS OWN palette's heart when chosen, not the current
    // one's — it is a swatch, not a control painted in the app's colours.
    b.style.setProperty("--pal-c1", stops[1]);
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.background = `linear-gradient(90deg, ${stops.join(",")})`;
    b.append(bar, t().palettes[p]);
    b.onclick = () => (prefs.palette = p);
    palGrid.appendChild(b);
    return b;
  });
  pal.appendChild(palGrid);

  // ---- background
  const bd = group(t().background);
  const bdGrid = document.createElement("div");
  bdGrid.className = "pickgrid";
  const bdButtons = BACKDROPS.map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bd";
    b.style.background = BACKDROP_COLOR[k];
    b.textContent = t().backdrops[k];
    b.onclick = () => (prefs.backdrop = k);
    bdGrid.appendChild(b);
    return b;
  });
  bd.appendChild(bdGrid);

  // ---- the meaning: folded to one row, unfolding in place
  const meaning = meaningPicker(meanings);
  offs.push(meaning.dispose);

  // ---- the two switches
  const toggles = (
    [
      ["translit", t().translit, t().translitFooter],
      ["mistakeSound", t().mistakeSound, t().mistakeSoundFooter],
    ] as const
  ).map(([key, text, footText]) => {
    const g = document.createElement("div");
    g.className = "sgroup";
    g.style.gap = "8px";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "toggle";
    b.setAttribute("role", "switch");
    const name = document.createElement("span");
    name.textContent = text;
    const track = document.createElement("span");
    track.className = "track";
    track.appendChild(document.createElement("span"));
    b.append(name, track);
    b.onclick = () => (prefs[key] = !prefs[key]);
    g.append(b, foot(footText));
    return { key, button: b, group: g };
  });

  // ---- language
  const langRow = document.createElement("div");
  langRow.className = "langrow";
  const langName = document.createElement("span");
  langName.textContent = t().languageTitle;
  langRow.append(langName, langPill(true));

  // Read from the prefs, never from what was last clicked — the same sheet can
  // be changed from outside it (a pinch on the page moves the text size).
  const sync = () => {
    syncSize();
    PALETTES.forEach((p, i) => palButtons[i].setAttribute("aria-pressed", String(prefs.palette === p)));
    BACKDROPS.forEach((k, i) => bdButtons[i].setAttribute("aria-pressed", String(prefs.backdrop === k)));
    for (const tg of toggles) tg.button.setAttribute("aria-checked", String(prefs[tg.key]));
  };
  sync();
  offs.push(prefs.onChange(sync));

  body.append(grabber(), head, size, pal, bd, meaning.el, ...toggles.map((tg) => tg.group), langRow);
  dialog.appendChild(body);
  return dialog;
}

/** "1.1 MB" / «١٫١ ميغابايت». */
function megabytes(bytes: number): string {
  const mb = (bytes / 1048576).toFixed(1);
  return t().meaningSize(lang() === "ar" ? arabicDigits(mb).replace(".", "٫") : mb);
}

/**
 * «معنى الآيات» — off, or one of the translations, each by its own name for
 * its language, with its translator and its size.
 *
 * **Folded until asked.** Folded it is one row — «معنى الآيات … English ⌄» —
 * because nine choices laid out in full took most of the settings sheet.
 * A tap unfolds the list in place; a pick that lands folds it again.
 *
 * **Choosing one downloads it, and only a finished, checked download changes
 * anything** (`Meanings.choose`): the row shows its progress, the setting and
 * the page stay as they were until it lands, and a failure says so on the row
 * and leaves everything else exactly as it was. While either is on screen the
 * list stays open, so the bar and the error are never folded out of sight.
 *
 * **«لغات أخرى…»** fetches QuranEnc's whole list from their API and adds every
 * translation the site does not ship, each downloaded from them on the spot
 * (`Meanings.loadMore`) — the shipped ones stay first.
 */
function meaningPicker(meanings: Meanings): { el: HTMLDivElement; dispose: () => void } {
  const g = document.createElement("div");
  g.className = "sgroup";
  g.style.gap = "8px";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "navrow";
  head.setAttribute("aria-expanded", "false");
  const name = document.createElement("span");
  name.textContent = t().meaning;
  const value = document.createElement("span");
  value.className = "nval";
  const chev = document.createElement("span");
  chev.className = "nchev";
  chev.innerHTML = icon("chevron");
  head.append(name, value, chev);

  const fold = document.createElement("div");
  fold.className = "mfold";
  fold.hidden = true;
  const list = document.createElement("div");
  list.className = "mlist";
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", t().meaningTitle);
  const source = foot(t().meaningSource);
  fold.append(list, source);

  const setOpen = (open: boolean) => {
    fold.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    if (open) g.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  };
  head.onclick = () => setOpen(fold.hidden);

  type Row = { key: string | null; el: HTMLButtonElement; stat: HTMLSpanElement; bar: HTMLSpanElement; err: HTMLSpanElement; entry: MeaningEntry | null };
  const ui = lang();
  const makeRow = (entry: MeaningEntry | null): Row => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "mpick";
    el.setAttribute("role", "radio");
    const text = document.createElement("span");
    text.className = "mptext";
    const label = document.createElement("span");
    label.className = "mpname";
    const sub = document.createElement("span");
    sub.className = "mpsub";
    if (entry) {
      // The language by its own name, so a reader of it finds it whatever
      // language the buttons are in; and under it, in the interface's.
      label.textContent = entry.native;
      label.lang = entry.language;
      const inUi = entry.name[ui];
      sub.textContent = inUi && inUi !== entry.native ? `${inUi} · ${entry.translator[ui]}` : entry.translator[ui];
    } else {
      label.textContent = t().meaningOff;
      sub.hidden = true;
    }
    const err = document.createElement("span");
    err.className = "mperr";
    err.textContent = t().meaningFailed;
    err.hidden = true;
    text.append(label, sub, err);
    const stat = document.createElement("span");
    stat.className = "mpstat";
    const check = document.createElement("span");
    check.className = "mpcheck";
    check.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    bar.className = "mpbar";
    bar.appendChild(document.createElement("span"));
    bar.hidden = true;
    el.append(text, stat, check, bar);
    const key = entry?.key ?? null;
    el.onclick = () => {
      const st = meanings.status;
      if (st.kind === "loading" && st.key === key) return; // already on its way
      void meanings.choose(key).then((landed) => {
        if (landed && meanings.chosen === key) setOpen(false);
      });
    };
    return { key, el, stat, bar, err, entry };
  };
  // ---- «لغات أخرى…»: the rest of QuranEnc, on request
  const more = document.createElement("button");
  more.type = "button";
  more.className = "mpick more";
  const moreText = document.createElement("span");
  moreText.className = "mptext";
  const moreName = document.createElement("span");
  moreName.className = "mpname";
  moreName.textContent = t().meaningMore;
  const moreSub = document.createElement("span");
  moreSub.className = "mpsub";
  moreSub.textContent = t().meaningMoreSub;
  moreText.append(moreName, moreSub);
  more.appendChild(moreText);
  const allHead = document.createElement("span");
  allHead.className = "mphead";
  more.onclick = () => {
    if (more.dataset.state === "loading") return;
    more.dataset.state = "loading";
    moreSub.textContent = t().meaningMoreLoading;
    void meanings.loadMore().then((ok) => {
      more.dataset.state = ok ? "" : "failed";
      moreSub.textContent = ok ? t().meaningMoreSub : t().meaningMoreFailed;
      if (ok) build();
    });
  };

  let rows: Row[] = [];
  /** The download the list last unfolded for — see the end of `sync`. */
  const signature = () => (meanings.status.kind === "idle" ? "" : `${meanings.status.kind}:${meanings.status.key}`);
  let unfoldedFor = signature();
  const build = () => {
    const extra = [...(meanings.more ?? [])].sort(
      (a, b) => a.name[ui].localeCompare(b.name[ui], ui) || a.translator[ui].localeCompare(b.translator[ui], ui),
    );
    rows = [null, ...meanings.shipped, ...extra].map(makeRow);
    const shipped = rows.slice(0, meanings.shipped.length + 1).map((r) => r.el);
    if (meanings.more) {
      allHead.textContent = t().meaningAll(formatNumber(meanings.languageCount));
      list.replaceChildren(...shipped, allHead, ...rows.slice(shipped.length).map((r) => r.el));
    } else {
      list.replaceChildren(...shipped, more);
    }
    sync();
  };

  const sync = () => {
    const st = meanings.status;
    const chosen = meanings.chosen;
    const entry = chosen ? meanings.entryFor(chosen) : null;
    value.textContent =
      st.kind === "loading" ? t().meaningProgress(formatNumber(Math.round(st.progress * 100))) : entry ? entry.native : t().meaningOff;
    if (entry && st.kind !== "loading") value.lang = entry.language;
    else value.removeAttribute("lang");
    for (const r of rows) {
      r.el.setAttribute("aria-checked", String(r.key === chosen));
      const loading = st.kind === "loading" && st.key === r.key;
      const failed = st.kind === "failed" && st.key === r.key;
      r.el.dataset.state = loading ? "loading" : failed ? "failed" : "";
      r.bar.hidden = !loading;
      if (loading) (r.bar.firstElementChild as HTMLElement).style.width = `${(st.progress * 100).toFixed(1)}%`;
      r.err.hidden = !failed;
      if (!r.entry) r.stat.textContent = "";
      else if (loading) r.stat.textContent = t().meaningProgress(formatNumber(Math.round(st.progress * 100)));
      else if (meanings.onDevice.has(r.entry.key)) r.stat.textContent = t().meaningOnDevice;
      else r.stat.textContent = r.entry.bytes > 0 ? megabytes(r.entry.bytes) : "";
    }
    // A download that starts, or fails, unfolds the list so its bar or its
    // error is in sight — once. A failure stays the store's state until the
    // next pick, and reopening on every update (or every time Settings opened)
    // overrode the reciter folding it away.
    const sig = signature();
    if (sig && sig !== unfoldedFor && fold.hidden) setOpen(true);
    unfoldedFor = sig;
  };
  build();
  const off = meanings.onChange(sync);

  g.append(head, fold, foot(t().meaningFooter));
  return { el: g, dispose: off };
}

/**
 * Letters only, for matching: no harakat, no tatweel, and every alef the same
 * alef — a reciter typing «البقرة» must find «البَقَرَة».
 */
function strip(s: string): string {
  return s.replace(/[ً-ٰٟۖ-ۭـ]/g, "").replace(/[أإآٱ]/g, "ا");
}
function latin(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * The index — all 114 surahs, searchable by name or number, each with its
 * ayah count and the mushaf page it opens on, so the reciter can go somewhere
 * without reciting their way there. The surah they last read is marked.
 *
 * The page number is the one the surah's FIRST ayah sits on, which is what a
 * printed index prints — checked against the AlKetab app's own index.
 */
export function surahSheet(corpus: QuranCorpus, lastSurah: number | null, onPick: (surah: number) => void): Sheet {
  const { dialog, head } = sheet("picker", t().chooseSurah, () => undefined);
  const body = document.createElement("div");
  body.className = "picker-body";
  const top = document.createElement("div");
  top.className = "picker-top";
  const search = document.createElement("label");
  search.className = "search";
  search.innerHTML = icon("search");
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = t().search;
  input.setAttribute("aria-label", t().search);
  input.autocomplete = "off";
  input.spellcheck = false;
  search.appendChild(input);
  top.append(grabber(), head, search);

  const list = document.createElement("div");
  list.className = "surahlist";
  const pages = new PageIndex();
  const en = lang() === "en";
  const rows: { el: HTMLButtonElement; n: number; ar: string; lat: string }[] = [];
  let lastRow: HTMLButtonElement | null = null;
  for (let n = 1; n <= 114; n++) {
    const info = corpus.surah(n);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "srow";
    const num = document.createElement("span");
    num.className = "snum";
    num.textContent = formatNumber(n);
    const text = document.createElement("span");
    text.className = "stext";
    const ar = document.createElement("span");
    ar.className = "sar";
    ar.lang = "ar";
    ar.textContent = info.name;
    const sub = document.createElement("span");
    sub.className = "ssub";
    const page = pages.page(corpus.ayahOrdinal(n, 1));
    sub.textContent = [en ? info.nameEn : null, t().ayahsN(formatNumber(info.ayahCount)), page === null ? null : t().pageShort(formatNumber(page))]
      .filter(Boolean)
      .join(" · ");
    text.append(ar, sub);
    row.append(num, text);
    if (n === lastSurah) {
      row.classList.add("last");
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t().lastHere;
      row.appendChild(badge);
      lastRow = row;
    }
    row.onclick = () => {
      dialog.close();
      onPick(n);
    };
    list.appendChild(row);
    rows.push({ el: row, n, ar: strip(info.name), lat: latin(info.nameEn) });
  }
  const none = document.createElement("div");
  none.className = "nomatch";
  none.textContent = t().noMatch;
  none.hidden = true;
  list.appendChild(none);

  input.oninput = () => {
    const q = input.value.trim();
    const qa = strip(q);
    const ql = latin(q);
    // Western or Arabic-Indic digits both find a surah by its number.
    const qn = Number(q.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
    let shown = 0;
    for (const r of rows) {
      const hit = !q || (qa && r.ar.includes(qa)) || (ql && r.lat.includes(ql)) || r.n === qn;
      r.el.hidden = !hit;
      if (hit) shown++;
    }
    none.hidden = shown > 0;
  };

  body.append(top, list);
  dialog.appendChild(body);
  // Open where the reciter left off, rather than at الفاتحة every time.
  if (lastRow) {
    const row = lastRow;
    dialog.addEventListener("focus", () => row.scrollIntoView({ block: "center" }), { once: true, capture: true });
  }
  return dialog;
}
