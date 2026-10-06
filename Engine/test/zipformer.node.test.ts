import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GreedyCtcDecoder } from "../src/browser/ctcDecoder.js";
import { KaldiFbank } from "../src/browser/kaldiFbank.js";
import { ZipformerRunner } from "../src/browser/zipformerRunner.js";
import { BLANK_ID, TOKENS } from "../src/model/tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
// The model is not committed. Prefer the site's copy (`npm run fetch-model`),
// then a sibling checkout, then QT_MODEL. Absent all three, this test skips.
const NAME = "quran_phoneme_zipformer.onnx";
const modelPath = [
  process.env.QT_MODEL,
  resolve(here, "../../QuranPrompter/public/models", NAME),
  resolve(here, "../../../Models", NAME),
].find((p) => p && existsSync(p)) as string | undefined;

describe.skipIf(!modelPath)("zipformer runner (onnxruntime-web in Node)", () => {
  it("decodes the reference clip to the same token string as margin_probe.py", async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.numThreads = 1;
    const fx = JSON.parse(readFileSync(resolve(here, "fixtures/decode.json"), "utf8")) as { samples: number[]; text: string; frames: number };
    const runner = await ZipformerRunner.create(ort, new Uint8Array(readFileSync(modelPath!)));
    const fbank = new KaldiFbank();
    const decoder = new GreedyCtcDecoder(TOKENS, BLANK_ID);
    const samples = Float32Array.from(fx.samples);
    let text = "";
    let frames = 0;
    const t0 = performance.now();
    let chunks = 0;
    for (let i = 0; i < samples.length; i += 7680) {
      const fr = fbank.acceptWaveform(samples.subarray(i, Math.min(samples.length, i + 7680)));
      const { logProbs, frames: n } = await runner.accept(fr);
      if (n === 0) continue;
      chunks++;
      frames += n;
      for (const t of decoder.consume(logProbs, n, runner.io.vocabSize)) text += t.sym;
    }
    for (const t of decoder.flush()) text += t.sym;
    const perChunk = (performance.now() - t0) / chunks;
    expect(frames).toBe(fx.frames);
    expect(text).toBe(fx.text);
    console.log(`zipformer: ${perChunk.toFixed(0)} ms per 480 ms chunk (wasm, 1 thread)`);
    expect(perChunk).toBeLessThan(480);
  }, 120_000);
});
