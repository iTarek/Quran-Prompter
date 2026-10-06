import { describe, expect, it } from "vitest";
import { RecitationEngine } from "../src/core/engine.js";
import type { EngineEvent, HeardToken, WordState } from "../src/core/types.js";
import { pausalPhonemes } from "../src/core/waqf.js";
import { ayahText, loadCorpus, loadIndex } from "./helpers.js";

/**
 * الوقف — stopping mid-ayah changes a word's ending, and that is recitation,
 * not error (waqf.ts has the rules).
 *
 * The reference bug, from a user report reproduced on a real recording:
 * stopping on نَارًا in 111:3 as "naaraa" was judged WRONG at distance 0.5,
 * while the identical reciter running it into ذَاتَ scored 0. These tests pin
 * both directions: the correct stop must be green, and the same pausal sound
 * WITHOUT a pause — and any genuinely wrong word, stopped or not — must stay
 * caught.
 */

/** Feeds text in 480 ms chunks (~5 chars each, 12 frames). */
function recite(engine: RecitationEngine, all: EngineEvent[], text: string, startFrame: number): number {
  let frame = startFrame;
  const cs = [...text];
  for (let i = 0; i < cs.length; i += 5) {
    const toks: HeardToken[] = cs.slice(i, i + 5).map((sym, k) => ({ sym, frame: frame + k * 2, margin: 1 }));
    frame += 12;
    all.push(...engine.feed(toks, frame));
  }
  return frame;
}

/** Silence: chunks with no tokens. */
function silence(engine: RecitationEngine, all: EngineEvent[], seconds: number, startFrame: number): number {
  let frame = startFrame;
  for (let s = 0; s < seconds * 25; s += 12) {
    frame += 12;
    all.push(...engine.feed([], frame));
  }
  return frame;
}

/** Last verdict each word received over the whole stream. */
function finalStates(all: EngineEvent[]): Map<number, WordState> {
  const out = new Map<number, WordState>();
  for (const e of all) if (e.type === "verdicts") for (const v of e.changes) out.set(v.wordIndex, v.state);
  return out;
}

const c = () => loadCorpus();
const word = (surah: number, ayah: number, w: number) => {
  const g = c().wordIndex(surah, ayah, w);
  return {
    g,
    phonemes: c().phonemes(g),
    plain: c().plainWord(g),
    atAyahEnd: w === c().ayahWordCount(surah, ayah) - 1,
  };
};
/** The rule as verdicts.ts asks it: mid-ayah unless the word says otherwise. */
const pausal = (w: { phonemes: string; plain: string; atAyahEnd: boolean }) =>
  pausalPhonemes(w.phonemes, w.plain, w.atAyahEnd);

describe("pausal forms (waqf.ts) on real corpus words", () => {
  it("tanween fath becomes a long alif", () => {
    const nara = word(111, 3, 1); // نَارًۭا — flowing نَاارَںںں, a cluster of noons
    expect(pausal(nara)).toBe("نَاارَاا");
    const huda = word(2, 2, 5); // هُدًۭى — flowing هُدَ, no cluster at all
    expect(huda.plain).toContain("ً");
    expect(pausal(huda)).toBe("هُدَاا");
  });

  it("tanween damm and kasr drop with their vowel", () => {
    const lahabin = word(111, 1, 3); // لَهَبٍۢ mid-ayah — flowing لَهَبِوو
    expect(pausal(lahabin)).toBe("لَهَب");
    const hablun = word(111, 5, 2); // حَبْلٌۭ — flowing حَبڇلُ
    expect(pausal(hablun)).toBe("حَبڇل");
  });

  it("tanween fath ON ta marbuta drops instead of growing an alif", () => {
    // ةً stops as "ah", never "ataa" — the ت stem stays for the cost table.
    expect(pausalPhonemes("رَحمَتَوو", "رَحْمَةًۭ", false)).toBe("رَحمَت");
  });

  it("a plain final short vowel is silenced", () => {
    const bism = word(1, 1, 0); // بِسمِ
    expect(pausal(bism)).toBe("بِسم");
  });

  it("words a stop cannot change return null", () => {
    const watabb = word(111, 1, 4); // وَتَبَّ — flowing وَتَببڇ, already closed
    expect(pausal(watabb)).toBeNull();
    const abi = word(111, 1, 2); // أَبِى — ends in a long vowel
    expect(pausal(abi)).toBeNull();
    const raqiba = word(4, 1, c().ayahWordCount(4, 1) - 1); // ayah end: already pausal
    expect(pausal(raqiba)).toBeNull();
  });

  it("an ayah's last word never derives one — it is already stopped", () => {
    // The corpus stores ayah-end words pausal while their plain text keeps its
    // tanween, so reading one as a flowing form invents a stem shorter than
    // the word: مُّسْتَمِرٍّ (54:19) derived ممممُستَم, which a truncated
    // recitation would then match as correct. `atAyahEnd` is the only thing
    // that can tell them apart, and this sweep is what keeps it wired.
    const corpus = c();
    for (let s = 1; s <= 114; s++) {
      const info = corpus.surah(s);
      for (let a = 1; a <= info.ayahCount; a++) {
        const last = corpus.ayahWordCount(s, a) - 1;
        const g = corpus.wordIndex(s, a, last);
        expect(pausalPhonemes(corpus.phonemes(g), corpus.plainWord(g), true)).toBeNull();
      }
    }
  });

  it("across the whole corpus, a derived form only ever trims the end or adds the alif", () => {
    // A sweep, so a corpus regeneration cannot smuggle in a shape the rules
    // misread: every pausal form shares the flowing form's head, and the only
    // thing ever appended is the alif of tanween fath.
    const corpus = c();
    for (let g = 0; g < corpus.wordCount; g++) {
      const ph = corpus.phonemes(g);
      const ref = corpus.ref(g);
      const atEnd = ref.word === corpus.ayahWordCount(ref.surah, ref.ayah) - 1;
      const p = pausalPhonemes(ph, corpus.plainWord(g), atEnd);
      if (p === null) continue;
      // Tanween fath ends in the appended alif; everything else is a pure trim.
      if (p.endsWith("اا") && !ph.startsWith(p)) {
        expect(ph.startsWith(p.slice(0, -2))).toBe(true);
      } else {
        expect(ph.startsWith(p)).toBe(true);
      }
    }
  });
});

describe("verdicts at a mid-ayah stop", () => {
  // The reported bug, replayed synthetically: سورة المسد, a stop on نَارًا.
  const NARA_WORD = () => c().wordIndex(111, 3, 1);
  const PAUSAL_NARA = "سَيَصلَاا" + "نَاارَاا";
  const REST_OF_3 = "ذَااتَ" + "لَهَبڇ";

  function fresh(): { engine: RecitationEngine; all: EngineEvent[] } {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.track(111, 1);
    return { engine, all: [] };
  }

  it("a correct stop on tanween fath, with a pause, is ok", () => {
    const { engine, all } = fresh();
    let f = recite(engine, all, ayahText(111, 1, 2), 0);
    f = recite(engine, all, PAUSAL_NARA, f);
    f = silence(engine, all, 1.5, f);
    f = recite(engine, all, REST_OF_3, f);
    silence(engine, all, 2, f);
    expect(finalStates(all).get(NARA_WORD())).toBe("ok");
  });

  it("the same pausal sound WITHOUT a pause earns no credit", () => {
    const { engine, all } = fresh();
    let f = recite(engine, all, ayahText(111, 1, 2), 0);
    f = recite(engine, all, PAUSAL_NARA + REST_OF_3, f);
    silence(engine, all, 2, f);
    // Judged against the flowing form only: a clean pausal pronunciation sits
    // at distance 0.25 there (two alifs where the noons should be), which is
    // `unsure` — the engine's usual reluctance to shout, not a pass. The pair
    // of this test and the one above IS the pause gate: same sound, and only
    // the actual stop turns it green.
    expect(finalStates(all).get(NARA_WORD())).toBe("unsure");
  });

  it("a genuinely wrong word is still wrong even with a pause after it", () => {
    const { engine, all } = fresh();
    let f = recite(engine, all, ayahText(111, 1, 2), 0);
    f = recite(engine, all, "سَيَصلَاا" + "عُصفُۥۥرُ", f); // not نَارًا in any form
    f = silence(engine, all, 1.5, f);
    f = recite(engine, all, REST_OF_3, f);
    silence(engine, all, 2, f);
    expect(finalStates(all).get(NARA_WORD())).toBe("wrong");
  });

  it("a stop on tanween kasr is ok", () => {
    const { engine, all } = fresh();
    // تبت يدا أبي لهبٍ — stopped as لَهَب — then وتبّ after the pause.
    let f = recite(engine, all, "تَببَتيَدَااااءَبِۦۦ" + "لَهَب", 0);
    f = silence(engine, all, 1.5, f);
    f = recite(engine, all, "وَتَببڇ", f);
    silence(engine, all, 2, f);
    expect(finalStates(all).get(c().wordIndex(111, 1, 3))).toBe("ok");
  });

  it("a stop on a plain final vowel is ok", () => {
    const engine = new RecitationEngine(loadCorpus(), loadIndex());
    engine.track(1, 1);
    const all: EngineEvent[] = [];
    // بِسم — stopped — then the rest of the basmala.
    let f = recite(engine, all, "بِسم", 0);
    f = silence(engine, all, 1.5, f);
    f = recite(engine, all, "للَااهِ" + "ررَحمَاانِ" + "ررَحِۦۦم", f);
    silence(engine, all, 2, f);
    expect(finalStates(all).get(c().wordIndex(1, 1, 0))).toBe("ok");
  });
});
