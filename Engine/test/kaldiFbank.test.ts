import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KaldiFbank } from "../src/browser/kaldiFbank.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("kaldi fbank port", () => {
  it("matches kaldi-native-fbank frame for frame", () => {
    const fx = JSON.parse(readFileSync(resolve(here, "fixtures/fbank.json"), "utf8")) as { samples: number[]; frames: number[][] };
    const fb = new KaldiFbank();
    const samples = Float32Array.from(fx.samples);
    // feed in uneven pieces to exercise the rolling buffer
    const got: Float32Array[] = [];
    for (let i = 0; i < samples.length; i += 1234) got.push(...fb.acceptWaveform(samples.subarray(i, Math.min(samples.length, i + 1234))));
    got.push(...fb.inputFinished());
    expect(got.length).toBe(fx.frames.length);
    let maxDiff = 0;
    for (let f = 0; f < got.length; f++) {
      for (let b = 0; b < 80; b++) maxDiff = Math.max(maxDiff, Math.abs(got[f][b] - fx.frames[f][b]));
    }
    expect(maxDiff).toBeLessThan(1e-3);
  });

  it("frame geometry: 25 ms window, 10 ms hop, snip_edges=false", () => {
    const fb = new KaldiFbank();
    expect(fb.acceptWaveform(new Float32Array(279)).length).toBe(0);
    expect(fb.acceptWaveform(new Float32Array(1)).length).toBe(1); // frame 0 ends at sample 280
    expect(fb.acceptWaveform(new Float32Array(160)).length).toBe(1);
  });
});
