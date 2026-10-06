import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { EngineEvent, RecitationEngine } from "@alketab/quran-engine";
import type { DecoderClient } from "@alketab/quran-engine/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrompterHost, type HostView } from "../src/host.js";
import { checkMeaning, Meanings, parseMeaning, type MeaningEntry, type MeaningFile } from "../src/meaning.js";
import { Prefs } from "../src/prefs.js";
import { MeaningSheet } from "../src/ui/meaning.js";
import { settingsSheet } from "../src/ui/sheets.js";
import { loadCorpus } from "./helpers.js";

const require = createRequire(import.meta.url);
const raw = (key: string) => readFileSync(require.resolve(`@alketab/quran-engine/data/translations/${key}.json`), "utf8");
const manifest = JSON.parse(raw("manifest")) as { translations: MeaningEntry[] };
const entry = (key: string): MeaningEntry => ({ ...manifest.translations.find((e) => e.key === key)!, hash: "test" });
const counts = () => Array.from({ length: 114 }, (_, i) => loadCorpus().surah(i + 1).ayahCount);
const english = (): MeaningFile => checkMeaning(JSON.parse(raw("english_saheeh")), "english_saheeh", counts());

beforeEach(() => localStorage.clear());

/**
 * happy-dom has no Cache API; this is the four calls `meaning.ts` makes of it,
 * in memory, so what is kept on the device — and what is evicted — can be seen.
 * Returns the store: absolute URL → text.
 */
function fakeCaches(): Map<string, string> {
  const files = new Map<string, string>();
  const abs = (u: string | Request) => new URL(typeof u === "string" ? u : u.url, "http://localhost/").href;
  const path = (u: string) => u.split("?")[0];
  const cache = {
    async match(u: string, opts?: { ignoreSearch?: boolean }) {
      const k = abs(u);
      const hit = files.get(k) ?? (opts?.ignoreSearch ? [...files].find(([kk]) => path(kk) === path(k))?.[1] : undefined);
      return hit === undefined ? undefined : new Response(hit);
    },
    async put(u: string, r: Response) {
      files.set(abs(u), await r.text());
    },
    async keys() {
      return [...files.keys()].map((k) => new Request(k));
    },
    async delete(r: Request) {
      return files.delete(abs(r));
    },
  };
  (globalThis as { caches?: unknown }).caches = { open: async () => cache };
  return files;
}
afterEach(() => delete (globalThis as { caches?: unknown }).caches);
const onDevice = (files: Map<string, string>) => [...files.keys()].map((k) => /([a-z_]+)\.json/.exec(k)![1]).sort();

describe("Prefs: prompterMeaning", () => {
  it("is off until a translation is picked", () => {
    expect(new Prefs().meaning).toBeNull();
    expect(new Prefs().showMeaning).toBe(false);
  });

  it("keeps the pick under prompterMeaning, for the next visit", () => {
    const prefs = new Prefs();
    prefs.meaning = "english_saheeh";
    expect(localStorage.getItem("prompterMeaning")).toBe("english_saheeh");
    expect(new Prefs().meaning).toBe("english_saheeh");
    prefs.meaning = null;
    expect(new Prefs().meaning).toBeNull();
  });

  it("reads anything that is not a key as off", () => {
    localStorage.setItem("prompterMeaning", "../../etc/passwd");
    expect(new Prefs().meaning).toBeNull();
  });

  // The same reasoning as the Latin readings: the words are hidden to test
  // what you remember, and the meaning under them hands it back.
  it("never shows in review mode, and leaves the setting alone", () => {
    const prefs = new Prefs();
    prefs.meaning = "english_saheeh";
    for (const mode of ["reading", "recognize", "praying"] as const) {
      prefs.mode = mode;
      expect(prefs.showMeaning).toBe(true);
    }
    prefs.mode = "memorizing";
    expect(prefs.showMeaning).toBe(false);
    expect(prefs.meaning).toBe("english_saheeh");
  });
});

describe("parseMeaning: QuranEnc's text, untouched", () => {
  it("joins back to the translation, character for character, in every shipped file", () => {
    for (const { key } of manifest.translations) {
      const file = JSON.parse(raw(key)) as MeaningFile;
      for (const ayah of Object.values(file.ayahs)) {
        expect(parseMeaning(ayah).pieces.map((p) => p.text).join("")).toBe(ayah.t);
      }
    }
  });

  it("makes a marker only of a [n] that has a note — the translators' own brackets stay text", () => {
    const { pieces, notes, unmarked } = parseMeaning(english().ayahs["1:2"]);
    expect(pieces.filter((p) => p.note !== undefined).map((p) => p.text)).toEqual(["[4]"]);
    expect(pieces[0].text).toBe("[All] praise is [due] to Allāh, Lord");
    expect(notes[0].text).toMatch(/^\[4\] When referring to Allāh/);
    expect(unmarked).toEqual([]);
  });

  it("never drops a note no marker points at", () => {
    const { pieces, notes, unmarked } = parseMeaning({ t: "text with no marker", f: "- a note with no number" });
    expect(pieces).toEqual([{ text: "text with no marker" }]);
    expect(notes[unmarked[0]].text).toBe("- a note with no number");
  });

  it("keeps a note's second line with it", () => {
    const { notes } = parseMeaning({ t: "a[1] b[2]", f: "[1] one\nmore of one\n[2] two" });
    expect(notes.map((n) => n.text)).toEqual(["[1] one\nmore of one", "[2] two"]);
  });
});

describe("checkMeaning: what arrives is checked again", () => {
  it("accepts a complete translation", () => {
    expect(Object.keys(english().ayahs)).toHaveLength(6236);
  });

  it("refuses one ayah short", () => {
    const f = JSON.parse(raw("english_saheeh")) as MeaningFile;
    delete f.ayahs["2:286"];
    expect(() => checkMeaning(f, "english_saheeh", counts())).toThrow(/2:286 is missing/);
  });

  it("refuses a file for another key", () => {
    expect(() => checkMeaning(JSON.parse(raw("english_saheeh")), "french_rashid", counts())).toThrow(/the file is english_saheeh/);
  });

  // QuranEnc publishes no version for the Arabic tafsir: the retrieval date stands in.
  it("takes a retrieval date where QuranEnc publishes no version, and nothing less", () => {
    const f = checkMeaning(JSON.parse(raw("arabic_moyassar")), "arabic_moyassar", counts());
    expect(f.version).toBeNull();
    expect(f.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(() => checkMeaning({ ...f, retrieved: undefined }, "arabic_moyassar", counts())).toThrow(/no version/);
  });
});

describe("Meanings.choose: a failure leaves the app exactly as it was", () => {
  const ok = (key: string) => (async () => new Response(raw(key))) as unknown as typeof fetch;
  const store = (fetchImpl: typeof fetch) => {
    const prefs = new Prefs();
    return { prefs, meanings: new Meanings(prefs, [entry("english_saheeh"), entry("french_rashid")], counts(), fetchImpl) };
  };

  it("sets the pick only once the translation is in hand", async () => {
    const { prefs, meanings } = store(ok("english_saheeh"));
    const done = meanings.choose("english_saheeh");
    expect(prefs.meaning).toBeNull();
    expect(meanings.status).toMatchObject({ kind: "loading", key: "english_saheeh" });
    expect(await done).toBe(true);
    expect(prefs.meaning).toBe("english_saheeh");
    expect(meanings.file?.ayahs["1:1"].t).toBe("In the name of Allāh,[2] the Entirely Merciful, the Especially Merciful.[3]");
  });

  it("keeps the previous choice when the network fails", async () => {
    const { prefs, meanings } = store(ok("english_saheeh"));
    await meanings.choose("english_saheeh");
    const failing = new Meanings(prefs, [entry("english_saheeh"), entry("french_rashid")], counts(), (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch);
    expect(await failing.choose("french_rashid")).toBe(false);
    expect(failing.status).toEqual({ kind: "failed", key: "french_rashid" });
    expect(prefs.meaning).toBe("english_saheeh");
  });

  it("refuses a download that is short of an ayah", async () => {
    const short = JSON.parse(raw("english_saheeh")) as MeaningFile;
    delete short.ayahs["114:6"];
    const { prefs, meanings } = store((async () => new Response(JSON.stringify(short))) as unknown as typeof fetch);
    expect(await meanings.choose("english_saheeh")).toBe(false);
    expect(prefs.meaning).toBeNull();
    expect(meanings.file).toBeNull();
  });

  it("keeps one translation on the device: the one showing", async () => {
    const files = fakeCaches();
    const { meanings } = store((async (url: string) => new Response(raw(String(url).includes("french") ? "french_rashid" : "english_saheeh"))) as unknown as typeof fetch);
    await meanings.choose("english_saheeh");
    expect(onDevice(files)).toEqual(["english_saheeh"]);
    await meanings.choose("french_rashid");
    expect(onDevice(files)).toEqual(["french_rashid"]);
    expect([...meanings.onDevice]).toEqual(["french_rashid"]);
  });

  // A download that loses to a newer choice used to evict everything else as
  // it was stored — including the copy the reciter had gone back to.
  it("never evicts the translation showing for a download that lost", async () => {
    const files = fakeCaches();
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    const { prefs, meanings } = store((async (url: string) => {
      if (!String(url).includes("french")) return new Response(raw("english_saheeh"));
      await gate;
      return new Response(raw("french_rashid"));
    }) as unknown as typeof fetch);
    await meanings.choose("english_saheeh");
    const french = meanings.choose("french_rashid");
    expect(await meanings.choose("english_saheeh")).toBe(true); // changed their mind
    release();
    expect(await french).toBe(false);
    expect(prefs.meaning).toBe("english_saheeh");
    expect(onDevice(files)).toContain("english_saheeh");
  });

  it("shows the older copy offline, and keeps it", async () => {
    const files = fakeCaches();
    const old = { ...entry("english_saheeh"), hash: "old" };
    await new Meanings(new Prefs(), [old], counts(), (async () => new Response(raw("english_saheeh"))) as unknown as typeof fetch).choose("english_saheeh");
    const offline = new Meanings(new Prefs(), [entry("english_saheeh")], counts(), (async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch);
    expect(await offline.choose("english_saheeh")).toBe(true);
    expect(offline.file?.ayahs["1:1"].t).toMatch(/^In the name of Allāh/);
    expect([...files.keys()]).toEqual(["http://localhost/data/translations/english_saheeh.json?v=old"]);
  });

  it("lets the last pick win when two downloads overlap", async () => {
    const { prefs, meanings } = store((async (url: string) => new Response(raw(String(url).includes("french") ? "french_rashid" : "english_saheeh"))) as unknown as typeof fetch);
    const first = meanings.choose("english_saheeh");
    const second = meanings.choose("french_rashid");
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(prefs.meaning).toBe("french_rashid");
  });
});

describe("«More languages…»: any QuranEnc translation, straight from them", () => {
  /** QuranEnc's API, played by the English file under another key. `failAt` answers that surah with a 503. */
  function quranEnc(short = false, failAt = 0, calls = { n: 0 }): typeof fetch {
    const src = english();
    const list = {
      translations: [
        { key: "english_saheeh", direction: "ltr", language_iso_code: "en", version: "1.1.2", title: "English Translation - Noor International Center" },
        { key: "persian_ih", direction: "rtl", language_iso_code: "fa", version: "1.1.3", title: "Persian Translation - Rowwad Translation Center" },
      ],
    };
    return (async (url: string) => {
      if (String(url).includes("/translations/list")) return new Response(JSON.stringify(list));
      const s = Number(/sura\/persian_ih\/(\d+)$/.exec(String(url))![1]);
      calls.n++;
      if (s === failAt) return new Response("", { status: 503 });
      const n = counts()[s - 1] - (short && s === 2 ? 1 : 0);
      const result = Array.from({ length: n }, (_, a) => {
        const ayah = src.ayahs[`${s}:${a + 1}`];
        return { sura: String(s), aya: String(a + 1), translation: ayah.t, footnotes: ayah.f ?? "" };
      });
      return new Response(JSON.stringify({ result }));
    }) as unknown as typeof fetch;
  }

  it("lists what the site does not ship, downloads it, and checks it like the rest", async () => {
    const prefs = new Prefs();
    const meanings = new Meanings(prefs, [entry("english_saheeh")], counts(), quranEnc());
    expect(await meanings.loadMore()).toBe(true);
    expect(meanings.more!.map((e) => e.key)).toEqual(["persian_ih"]);
    expect(meanings.more![0].translator.en).toBe("Rowwad Translation Center");
    expect(meanings.languageCount).toBe(2);
    expect(await meanings.choose("persian_ih")).toBe(true);
    expect(prefs.meaning).toBe("persian_ih");
    expect(meanings.file!.dir).toBe("rtl");
    expect(meanings.file!.version).toBe("1.1.3");
    expect(Object.keys(meanings.file!.ayahs)).toHaveLength(6236);
    // Verbatim, footnotes and all.
    expect(meanings.file!.ayahs["1:1"]).toEqual(english().ayahs["1:1"]);
  });

  // The other three workers used to fetch on after a failure, and their
  // progress put «loading» back over the error, for good.
  it("stops at the first failed surah, and stays failed", async () => {
    const calls = { n: 0 };
    const prefs = new Prefs();
    const meanings = new Meanings(prefs, [entry("english_saheeh")], counts(), quranEnc(false, 5, calls));
    await meanings.loadMore();
    expect(await meanings.choose("persian_ih")).toBe(false);
    await new Promise((ok) => setTimeout(ok, 30));
    expect(meanings.status).toEqual({ kind: "failed", key: "persian_ih" });
    expect(calls.n).toBeLessThan(12);
    expect(prefs.meaning).toBeNull();
  });

  it("refuses a live download that comes back an ayah short", async () => {
    const prefs = new Prefs();
    const meanings = new Meanings(prefs, [entry("english_saheeh")], counts(), quranEnc(true));
    await meanings.loadMore();
    expect(await meanings.choose("persian_ih")).toBe(false);
    expect(prefs.meaning).toBeNull();
    expect(meanings.status).toEqual({ kind: "failed", key: "persian_ih" });
  });
});

describe("the picker in Settings", () => {
  const fold = (sheet: HTMLElement) => sheet.querySelector<HTMLDivElement>(".mfold")!;
  const offline = (async () => {
    throw new TypeError("offline");
  }) as unknown as typeof fetch;

  it("is folded to one row until tapped", () => {
    const meanings = new Meanings(new Prefs(), [entry("english_saheeh")], counts(), offline);
    const sheet = settingsSheet(loadCorpus(), new Prefs(), meanings);
    expect(fold(sheet).hidden).toBe(true);
    sheet.querySelector<HTMLButtonElement>(".navrow")!.click();
    expect(fold(sheet).hidden).toBe(false);
  });

  // A failure stays the store's state until the next pick; it used to unfold
  // the list on every update after the reciter had folded it away.
  it("unfolds for a failure once, and stays folded when folded", async () => {
    const prefs = new Prefs();
    const meanings = new Meanings(prefs, [entry("english_saheeh")], counts(), offline);
    const sheet = settingsSheet(loadCorpus(), prefs, meanings);
    await meanings.choose("english_saheeh");
    expect(fold(sheet).hidden).toBe(false);
    expect(sheet.querySelector<HTMLElement>(".mpick[data-state=failed] .mperr")!.hidden).toBe(false);
    sheet.querySelector<HTMLButtonElement>(".navrow")!.click(); // folds it
    await meanings.restore(); // any later update
    expect(fold(sheet).hidden).toBe(true);
    // And a Settings opened later starts folded, the failure still on its row.
    expect(fold(settingsSheet(loadCorpus(), prefs, meanings)).hidden).toBe(true);
  });
});

/**
 * The sheet, fed by the REAL host: a scripted engine hands `PrompterHost` the
 * events a recitation produces, and the host tells the sheet what it tells
 * the page.
 */
describe("the meaning sheet, following the engine", () => {
  function rig() {
    const corpus = loadCorpus();
    const prefs = new Prefs();
    prefs.mode = "recognize";
    const sheet = new MeaningSheet();
    document.body.appendChild(sheet.el);
    sheet.setFile(english(), entry("english_saheeh"));
    sheet.setEnabled(true);
    const queue: EngineEvent[][] = [];
    const engine = {
      corpus,
      setStayOnSurah() {},
      setHint() {},
      startSearch() {},
      track: () => [],
      feed: () => queue.shift() ?? [],
    } as unknown as RecitationEngine;
    const decoder = { reset() {}, pushAudio() {} } as unknown as DecoderClient;
    const view: HostView = {
      phase: (p) => sheet.phase(p),
      micLive() {},
      mounted: (s, a) => sheet.mounted(s, a),
      cursor: (s, a) => sheet.cursor(s, a),
      verdicts() {},
      log() {},
    };
    const host = new PrompterHost(engine, decoder, view, prefs);
    /** One chunk of audio's worth of engine events. */
    const hear = (...events: EngineEvent[]) => {
      queue.push(events);
      host.onTokens([], 0);
    };
    const shown = () => (sheet.visible ? sheet.el.querySelector(".mtext")!.textContent : null);
    const ring = () => sheet.el.querySelector(".mring")!.textContent;
    return { prefs, sheet, hear, shown, ring, corpus };
  }

  it("shows nothing while the engine is still searching", () => {
    const { hear, shown } = rig();
    hear({ type: "hearing", words: [0, 1, 2] });
    hear({ type: "hearing", words: [0, 1, 2, 3] });
    expect(shown()).toBeNull();
  });

  it("shows the located ayah's meaning, and the next one's when the cursor moves on", () => {
    const { hear, shown, ring, corpus } = rig();
    hear({ type: "hearing", words: [0, 1] });
    hear({ type: "located", surah: 1, ayah: 4, word: 0, replayed: 0 });
    expect(shown()).toBe("Sovereign of the Day of Recompense.[5]");
    expect(ring()).toBe("٤");
    // Words inside the same ayah change nothing.
    hear({ type: "cursor", surah: 1, ayah: 4, word: 2, wordIndex: corpus.wordIndex(1, 4, 2) });
    expect(ring()).toBe("٤");
    hear({ type: "cursor", surah: 1, ayah: 5, word: 0, wordIndex: corpus.wordIndex(1, 5, 0) });
    expect(shown()).toBe("It is You we worship and You we ask for help.");
    expect(ring()).toBe("٥");
  });

  it("goes when the run returns to listening, and stays gone until the next locate", () => {
    const { hear, shown } = rig();
    hear({ type: "located", surah: 1, ayah: 6, word: 0, replayed: 0 });
    expect(shown()).toBe("Guide us to the straight path -");
    hear({ type: "completed", surah: 1 });
    expect(shown()).toBeNull();
    hear({ type: "hearing", words: [5] });
    expect(shown()).toBeNull();
    hear({ type: "located", surah: 112, ayah: 1, word: 0, replayed: 0 });
    expect(shown()).toMatch(/^Say, "He is Allāh, \[who is\] One,/);
  });

  it("is hidden in review mode, whatever the engine says", () => {
    const { prefs, sheet, hear, shown } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    prefs.mode = "memorizing";
    sheet.setEnabled(prefs.showMeaning);
    expect(shown()).toBeNull();
  });

  it("credits the translator and the source on every meaning — no version, no link", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    expect(sheet.el.querySelector(".mcredit")!.textContent).toBe("مركز نور إنترناشونال · موسوعة القرآن");
    expect(sheet.el.querySelector(".mcredit a")).toBeNull();
    sheet.setFile(checkMeaning(JSON.parse(raw("arabic_moyassar")), "arabic_moyassar", counts()), entry("arabic_moyassar"));
    expect(sheet.el.querySelector(".mcredit")!.textContent).toBe("التفسير الميسر · موسوعة القرآن");
  });

  it("opens a footnote, verbatim, from its marker", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    const marker = sheet.el.querySelector<HTMLButtonElement>(".mtext .fn")!;
    expect(marker.textContent).toBe("[2]");
    marker.click();
    expect(sheet.el.querySelector<HTMLDivElement>(".mnote")!.hidden).toBe(false);
    expect(sheet.el.querySelector(".mnote p")!.textContent).toBe(english().ayahs["1:1"].f!.split("\n")[0]);
    expect(sheet.el.dataset.open).toBe("1");
  });

  it("hides with a tap on the line and comes back with another — the line stays, and never opens it", () => {
    const { hear, sheet, corpus } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    const line = sheet.el.querySelector<HTMLButtonElement>(".mgrab")!;
    const body = sheet.el.querySelector<HTMLDivElement>(".mbody")!;
    line.click();
    expect(sheet.el.dataset.tucked).toBe("1");
    expect(sheet.el.dataset.open).toBe("0"); // not the arrow's job
    expect(sheet.visible).toBe(true); // the line is still there to tap
    expect(body.hasAttribute("inert")).toBe(true);
    expect(line.closest("[inert]")).toBeNull();
    // Put away on purpose: it stays away as the reciter moves on.
    hear({ type: "cursor", surah: 1, ayah: 2, word: 0, wordIndex: corpus.wordIndex(1, 2, 0) });
    expect(sheet.el.dataset.tucked).toBe("1");
    line.click();
    expect(sheet.el.dataset.tucked).toBe("0");
    expect(body.hasAttribute("inert")).toBe(false);
    expect(sheet.el.querySelector(".mring")!.textContent).toBe("٢");
  });

  it("opens and folds with the arrow, which never hides it", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    const arrow = sheet.el.querySelector<HTMLButtonElement>(".mhead")!;
    arrow.click();
    expect(sheet.el.dataset.open).toBe("1");
    expect(sheet.el.dataset.tucked).toBe("0");
    arrow.click();
    expect(sheet.el.dataset.open).toBe("0");
    expect(sheet.el.dataset.tucked).toBe("0");
  });

  it("hides with a swipe down on the line, and comes back with a swipe up", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    const line = sheet.el.querySelector<HTMLButtonElement>(".mgrab")!;
    const swipe = (from: number, to: number) => {
      line.dispatchEvent(new PointerEvent("pointerdown", { clientY: from, bubbles: true }));
      line.dispatchEvent(new PointerEvent("pointerup", { clientY: to, bubbles: true }));
    };
    swipe(100, 160);
    expect(sheet.el.dataset.tucked).toBe("1");
    swipe(160, 100);
    expect(sheet.el.dataset.tucked).toBe("0");
  });

  // A touch swipe fires no click, and the flag meant to swallow one used to
  // stay up and eat the next real tap.
  it("answers the next tap after a swipe", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    const head = sheet.el.querySelector<HTMLButtonElement>(".mhead")!;
    const press = (type: string, y: number) => head.dispatchEvent(new PointerEvent(type, { clientY: y, bubbles: true }));
    press("pointerdown", 100);
    press("pointerup", 50); // swipe up, and no click follows
    expect(sheet.el.dataset.open).toBe("1");
    press("pointerdown", 60);
    press("pointerup", 60);
    head.click(); // a tap
    expect(sheet.el.dataset.open).toBe("0");
  });

  it("sets the meaning in its own language's direction — Urdu right to left", () => {
    const { hear, sheet } = rig();
    hear({ type: "located", surah: 1, ayah: 1, word: 0, replayed: 0 });
    expect(sheet.el.querySelector<HTMLParagraphElement>(".mtext")!.dir).toBe("ltr");
    sheet.setFile(checkMeaning(JSON.parse(raw("urdu_junagarhi")), "urdu_junagarhi", counts()), entry("urdu_junagarhi"));
    expect(sheet.el.querySelector<HTMLParagraphElement>(".mtext")!.dir).toBe("rtl");
  });
});
