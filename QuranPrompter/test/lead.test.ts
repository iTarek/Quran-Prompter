import { describe, expect, it } from "vitest";
import { PromptPage } from "../src/ui/page.js";
import { loadCorpus } from "./helpers.js";

/**
 * The word after the cursor is marked as the lead — where the reciter most
 * likely is by now, since the engine lands each word 1.0–1.2 s after it was
 * begun (measured on rahman.wav).
 */
describe("the lead: the word after the cursor", () => {
  function page(surah: number) {
    const corpus = loadCorpus();
    const p = new PromptPage(corpus);
    document.body.appendChild(p.el);
    p.mount(surah);
    const first = corpus.surah(surah).firstWord;
    const leads = () => [...p.el.querySelectorAll<HTMLElement>(".chip[data-lead]")].map((c) => Number(c.dataset.w) - first);
    const current = () => [...p.el.querySelectorAll<HTMLElement>(".chip[data-current]")].map((c) => Number(c.dataset.w) - first);
    return { p, corpus, first, leads, current };
  }

  it("is the word after the cursor, and only that one", () => {
    const { p, first, leads, current } = page(1);
    p.setCurrent(first);
    expect(current()).toEqual([0]);
    expect(leads()).toEqual([1]);
    p.setCurrent(first + 3);
    expect(leads()).toEqual([4]);
  });

  it("crosses into the next ayah — a prompter prompts what comes next", () => {
    const { p, corpus, leads } = page(1);
    const last = corpus.ayahFirstWord(1, 1) + corpus.ayahWordCount(1, 1) - 1;
    p.setCurrent(last);
    expect(leads()).toEqual([last + 1 - corpus.surah(1).firstWord]);
    expect(corpus.ref(last + 1).ayah).toBe(2);
  });

  it("is nowhere past the last word of the surah", () => {
    const { p, corpus, leads } = page(1);
    p.setCurrent(corpus.surah(1).endWord - 1);
    expect(leads()).toEqual([]);
  });

  it("goes with the marks when a new run starts", () => {
    const { p, first, leads } = page(1);
    p.setCurrent(first + 1);
    p.clearMarks();
    expect(leads()).toEqual([]);
  });

  it("follows the cursor back when the reciter repeats", () => {
    const { p, first, leads } = page(1);
    p.setCurrent(first + 5);
    p.setCurrent(first + 2);
    expect(leads()).toEqual([3]);
  });
});
