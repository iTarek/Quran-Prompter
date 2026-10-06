import { describe, expect, it } from "vitest";
import { GreedyCtcDecoder } from "../src/browser/ctcDecoder.js";

const SYMS = ["a", "b", "c", "<blank>"];
const BLANK = 3;

/** Frames as [best, bestLogProb, second, secondLogProb]. */
function frames(rows: [number, number, number, number][]): Float32Array {
  const out = new Float32Array(rows.length * SYMS.length).fill(-20);
  rows.forEach(([b, bv, s, sv], t) => {
    out[t * SYMS.length + b] = bv;
    out[t * SYMS.length + s] = sv;
  });
  return out;
}

describe("greedy CTC decoder", () => {
  it("collapses repeats, drops blanks, and emits on run end", () => {
    const d = new GreedyCtcDecoder(SYMS, BLANK);
    const lp = frames([
      [0, -0.1, 1, -3], // a
      [0, -0.2, 1, -3], // a (same run)
      [BLANK, -0.1, 0, -3],
      [1, -0.5, 2, -1], // b
      [BLANK, -0.1, 1, -3],
    ]);
    const toks = d.consume(lp, 5, SYMS.length);
    expect(toks.map((t) => t.sym)).toEqual(["a", "b"]);
    expect(toks[0].frame).toBe(0);
    expect(toks[1].frame).toBe(3);
    expect(d.framesDecoded).toBe(5);
  });

  it("carries the collapse state across chunk boundaries", () => {
    const d = new GreedyCtcDecoder(SYMS, BLANK);
    const first = d.consume(frames([[0, -0.1, 1, -3]]), 1, SYMS.length);
    expect(first).toEqual([]); // run still open
    const second = d.consume(frames([[0, -0.1, 1, -3], [BLANK, -0.1, 0, -3]]), 2, SYMS.length);
    expect(second.map((t) => t.sym)).toEqual(["a"]); // not twice
  });

  it("takes the margin at the peak frame, replacing never appending", () => {
    const d = new GreedyCtcDecoder(SYMS, BLANK);
    const lp = frames([
      [0, Math.log(0.4), 1, Math.log(0.39)], // transition frame: near tie
      [0, Math.log(0.99), 1, Math.log(0.005)], // peak
      [0, Math.log(0.7), 1, Math.log(0.2)],
      [BLANK, -0.1, 0, -3],
    ]);
    const toks = d.consume(lp, 4, SYMS.length);
    expect(toks.length).toBe(1);
    expect(toks[0].margin).toBeCloseTo(0.985, 3);
  });

  it("a token directly followed by another emits both", () => {
    const d = new GreedyCtcDecoder(SYMS, BLANK);
    const toks = d.consume(frames([[0, -0.1, 1, -3], [1, -0.1, 0, -3], [BLANK, -0.1, 0, -3]]), 3, SYMS.length);
    expect(toks.map((t) => t.sym)).toEqual(["a", "b"]);
  });

  it("flush emits an open run", () => {
    const d = new GreedyCtcDecoder(SYMS, BLANK);
    d.consume(frames([[2, -0.1, 1, -3]]), 1, SYMS.length);
    expect(d.flush().map((t) => t.sym)).toEqual(["c"]);
    expect(d.flush()).toEqual([]);
  });
});
