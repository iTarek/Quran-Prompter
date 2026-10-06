import { expect, it } from "vitest";
import { RecitationEngine, type HeardToken } from "../src/core/index.js";
import { ayahText, loadCorpus, loadIndex } from "./helpers.js";

it("Al-Baqara tracking stays well under real time per chunk", () => {
  const engine = new RecitationEngine(loadCorpus(), loadIndex());
  engine.track(2, 1);
  const text = ayahText(2, 1, 40);
  const cs = [...text];
  let frame = 0;
  const t0 = performance.now();
  let chunks = 0;
  for (let i = 0; i < cs.length; i += 5) {
    const toks: HeardToken[] = cs.slice(i, i + 5).map((sym, k) => ({ sym, frame: frame + k * 2, margin: 1 }));
    frame += 12;
    engine.feed(toks, frame);
    chunks++;
  }
  const perChunk = (performance.now() - t0) / chunks;
  expect(engine.tracker?.cursor.ayah).toBe(40);
  expect(perChunk).toBeLessThan(120); // a chunk is 480 ms of audio
});
