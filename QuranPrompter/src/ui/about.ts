import type { QuranCorpus } from "@alketab/quran-engine";
import { contactHref, debugFacts, type BuildInfo } from "../contact.js";
import { icon } from "../icons.js";
import { formatNumber, lang, uiDir } from "../lang.js";
import { QURANENC_URL, type Meanings } from "../meaning.js";
import { MODES, type Mode, type Prefs } from "../prefs.js";
import { t } from "../strings.js";
import { label, roundButton } from "./home.js";

declare const __APP_VERSION__: string;
declare const __MODEL_VERSION__: string;
declare const __DATA_VERSION__: string;

/**
 * The browser's own install prompt, when it offers one. Chrome/Edge fire
 * `beforeinstallprompt`; Safari never does, which is why the written steps
 * are always shown rather than being a fallback.
 */
export interface Installer {
  available(): boolean;
  prompt(): void;
}

export interface AboutActions {
  installer: Installer;
  /** A mode card was chosen: the sitting restarts in it. */
  onMode(mode: Mode): void;
  /** «ابدأ التلاوة الآن» — fired inside the press, so the gesture is live. */
  onStart(): void;
}

/**
 * «عن ملقّن القرآن» — the whole story on one scrolling page: what it does
 * (with the basmala lighting up word by word, as the page will), the four
 * modes (each one a way in), when it helps, what the colours mean and the
 * gesture no one would find alone, how to install it, and the promise the
 * rest rests on — the voice never leaves the device.
 *
 * A full-screen `<dialog>`: Esc and the back button both close it, and focus
 * cannot wander into the start screen behind it.
 */
export function aboutPage(corpus: QuranCorpus, prefs: Prefs, meanings: Meanings, actions: AboutActions): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "about";
  dialog.dir = uiDir();
  let demoTimer = 0;
  dialog.addEventListener(
    "close",
    () => {
      clearInterval(demoTimer);
      dialog.remove();
    },
    { once: true },
  );

  // ---- bar
  const bar = document.createElement("div");
  bar.className = "abar";
  const back = roundButton("back");
  label(back, t().back);
  back.onclick = () => dialog.close();
  const barTitle = document.createElement("span");
  barTitle.textContent = t().about;
  bar.append(back, barTitle);

  // ---- hero
  const hero = document.createElement("section");
  hero.className = "ahero";
  const logo = document.createElement("img");
  logo.src = "/quran-prompter-icon-wave-512.png";
  logo.alt = "";
  const h1 = document.createElement("h1");
  h1.textContent = t().appTitle;
  // Under the name: whose open-source technology this stands on.
  const credit = t().info.poweredBy;
  const powered = document.createElement("p");
  powered.className = "poweredby";
  powered.append(credit.before, link("https://quranlab.ai/", credit.link), credit.after);
  const intro = document.createElement("p");
  intro.className = "intro";
  intro.textContent = t().info.intro;
  // The basmala, lit one word at a time — the page's own word states, on the
  // page's own glyphs, so the demonstration cannot drift from the real thing.
  const demo = document.createElement("p");
  demo.className = "demo";
  demo.setAttribute("aria-hidden", "true");
  const first = corpus.ayahFirstWord(1, 1);
  const count = corpus.ayahWordCount(1, 1);
  const demoWords: HTMLSpanElement[] = [];
  for (let w = 0; w < count; w++) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = corpus.displayWord(first + w);
    demo.appendChild(chip);
    demoWords.push(chip);
  }
  // Eight beats: the cursor walks the four words, all four hold lit for two,
  // then two beats dark before it starts again.
  let beat = 0;
  const step = () => {
    const cur = beat <= 3 ? beat : beat <= 5 ? count : -1;
    demoWords.forEach((chip, i) => {
      if (cur >= 0 && i < cur) chip.dataset.state = "ok";
      else delete chip.dataset.state;
      if (i === cur) chip.dataset.current = "1";
      else delete chip.dataset.current;
    });
    beat = (beat + 1) % 8;
  };
  step();
  demoTimer = window.setInterval(step, 720);
  const trust = document.createElement("div");
  trust.className = "trust";
  for (const x of t().info.trust) {
    const s = document.createElement("span");
    s.textContent = x;
    trust.appendChild(s);
  }
  hero.append(logo, h1, powered, intro, demo, trust);

  // ---- the modes
  const modes = section(t().modesTitle, "first");
  const modeGrid = document.createElement("div");
  modeGrid.className = "agrid";
  for (const m of MODES) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card";
    const on = m === prefs.mode;
    card.setAttribute("aria-pressed", String(on));
    const ch = document.createElement("span");
    ch.className = "chead";
    const name = document.createElement("span");
    name.textContent = t().modes[m];
    ch.appendChild(name);
    if (on) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = t().current;
      ch.appendChild(badge);
    }
    const p = document.createElement("p");
    p.textContent = t().modeHelp[m];
    card.append(ch, p);
    card.onclick = () => {
      dialog.close();
      actions.onMode(m);
    };
    modeGrid.appendChild(card);
  }
  modes.appendChild(modeGrid);

  // ---- when it helps
  const uses = section(t().info.when);
  const useGrid = document.createElement("div");
  useGrid.className = "agrid wide";
  t().info.cases.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "card";
    const n = document.createElement("span");
    n.className = "num gradtext";
    n.textContent = formatNumber(0) + formatNumber(i + 1);
    const h3 = document.createElement("h3");
    h3.textContent = c.title;
    const p = document.createElement("p");
    p.textContent = c.detail;
    card.append(n, h3, p);
    useGrid.appendChild(card);
  });
  uses.appendChild(useGrid);

  // ---- tips: what the colours say, and the tap that makes a word heard
  const tips = section(t().tipsTitle);
  const tipGrid = document.createElement("div");
  tipGrid.className = "agrid tips";
  const legend = document.createElement("div");
  legend.className = "card legend-card";
  const legendIntro = document.createElement("span");
  legendIntro.textContent = t().colorsIntro;
  legend.appendChild(legendIntro);
  // The swatches take their colours from the same custom properties the words
  // do; a hex written here would be a second source of truth.
  const LEGEND = [
    ["now", "current"],
    ["lead", "lead"],
    ["ok", "ok"],
    ["pending", "pending"],
    ["skipped", "skipped"],
    ["wrong", "wrong"],
  ] as const;
  for (const [swatch, name] of LEGEND) {
    const row = document.createElement("div");
    row.className = "legend-row";
    const s = document.createElement("span");
    s.className = `swatch ${swatch}`;
    row.append(s, t().colorNames[name]);
    legend.appendChild(row);
  }
  const tapCard = document.createElement("div");
  tapCard.className = "card tap-card";
  const tapText = document.createElement("span");
  tapText.textContent = t().tipTap;
  tapCard.innerHTML = icon("speaker");
  tapCard.appendChild(tapText);
  tipGrid.append(legend, tapCard);
  tips.appendChild(tipGrid);

  // ---- the translations of the meanings: QuranEnc's terms ask for the
  // translator and QuranEnc.com here as well as under every meaning shown —
  // and the version, which is how a reader knows which text they had.
  const credits = section(t().info.meaningsTitle);
  const ccard = document.createElement("div");
  ccard.className = "card meanings-card";
  const cintro = document.createElement("p");
  cintro.textContent = t().info.meaningsBody;
  const clist = document.createElement("ul");
  const ui = lang();
  for (const e of meanings.shipped) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "cname";
    name.textContent = e.name[ui];
    li.append(name, ` — ${e.translator[ui]}`);
    // The version, which QuranEnc's terms ask for — here, where the credits
    // are, rather than under every meaning. The Arabic tafsir has none.
    if (e.version) {
      const ver = document.createElement("span");
      ver.className = "cver";
      ver.textContent = `v${e.version}`;
      li.append(" · ", ver);
    }
    clist.appendChild(li);
  }
  ccard.append(cintro, clist, link(QURANENC_URL, "QuranEnc.com"));
  credits.appendChild(ccard);

  // ---- install
  const install = section(t().install.title);
  const card = document.createElement("div");
  card.className = "card install-card";
  const ihead = document.createElement("div");
  ihead.className = "ihead";
  ihead.innerHTML = icon("install");
  const ibody = document.createElement("p");
  ibody.textContent = t().install.body;
  ihead.appendChild(ibody);
  const ibtn = document.createElement("button");
  ibtn.type = "button";
  ibtn.className = "cta";
  ibtn.textContent = t().install.button;
  ibtn.onclick = () => actions.installer.prompt();
  // Whether the browser will offer a one-tap install is only knowable now.
  ibtn.hidden = !actions.installer.available();
  const steps = document.createElement("ul");
  for (const step of [t().install.ios, t().install.android, t().install.desktop]) {
    const li = document.createElement("li");
    li.textContent = step;
    steps.appendChild(li);
  }
  card.append(ihead, ibtn, steps);
  install.appendChild(card);

  // ---- the promise
  const privacy = document.createElement("section");
  privacy.className = "asec aprivacy";
  const ph = document.createElement("h2");
  ph.textContent = t().info.privacyTitle;
  const pside = document.createElement("div");
  const pp = document.createElement("p");
  pp.textContent = t().info.privacyBody;
  const start = document.createElement("button");
  start.type = "button";
  start.className = "cta";
  start.textContent = t().startLong;
  start.onclick = () => {
    dialog.close();
    actions.onStart();
  };
  // «تواصل معنا», beside it: an email with the app's name as its subject and,
  // under room to write, what a bug report needs — read when it is pressed,
  // so the mode and place in it are the ones the reciter is in.
  const build: BuildInfo = { version: __APP_VERSION__, model: __MODEL_VERSION__, data: __DATA_VERSION__ };
  const contact = document.createElement("a");
  contact.className = "contact";
  const write = () => (contact.href = contactHref(t().appTitle, debugFacts(prefs, build)));
  write();
  contact.onclick = write;
  contact.innerHTML = icon("mail");
  contact.append(t().contactUs);
  const buttons = document.createElement("div");
  buttons.className = "aactions";
  buttons.append(start, contact);
  pside.append(pp, buttons);
  privacy.append(ph, pside);

  // ---- footer, with the colophon: the build a phone is really running
  const footer = document.createElement("footer");
  footer.className = "afoot";
  const needs = document.createElement("span");
  needs.textContent = t().info.needs;
  const links = document.createElement("div");
  links.className = "links";
  links.append(
    link("https://quran.alketab.app", t().info.appLink),
    link("/privacy.html", t().info.privacy),
    // The model is Quran Lab's, under their NPL-1.2, which travels with every
    // copy — and this site hands out a copy. NOTICE.md in the repository.
    link("/licenses/quran-lab-npl-1.2.txt", t().modelLicense),
    colophon(),
  );
  footer.append(needs, links);

  dialog.append(bar, hero, modes, uses, tips, ...(meanings.shipped.length ? [credits] : []), install, privacy, footer);
  return dialog;
}

function section(title: string, extra = ""): HTMLElement {
  const s = document.createElement("section");
  s.className = `asec ${extra}`.trim();
  const h2 = document.createElement("h2");
  h2.textContent = title;
  s.appendChild(h2);
  return s;
}

/**
 * Always a new tab — the privacy page too, though it is our own: navigating
 * this tab away would end the sitting and throw away a warm 72 MB model.
 */
function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
}

/** «© iPhoneIslam.com — V3.0.0», in full: how anyone tells which build they have. */
function colophon(): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = "colophon";
  const site = document.createElement("a");
  site.href = "https://iphoneislam.com";
  site.target = "_blank";
  site.rel = "noopener noreferrer";
  site.textContent = "iPhoneIslam.com";
  c.append("© ", site, ` — V${__APP_VERSION__}`);
  return c;
}
