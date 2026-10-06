import { describe, expect, it } from "vitest";
import { charCost, costTable } from "../src/core/index.js";

describe("phoneme cost", () => {
  it("notation variants are free", () => {
    expect(charCost("ۦ", "ي")).toBe(0);
    expect(charCost("ۥ", "و")).toBe(0);
    expect(charCost("ں", "ن")).toBe(0);
    expect(charCost("۾", "م")).toBe(0);
  });
  it("hamza family costs 0.1, gutturals are not in it", () => {
    expect(charCost("ء", "ا")).toBe(0.1);
    expect(charCost("ا", "ه")).toBe(1);
    expect(charCost("ء", "ع")).toBe(0.25);
  });
  it("neighbours cost 0.25 and are symmetric", () => {
    expect(charCost("س", "ص")).toBe(0.25);
    expect(charCost("ص", "س")).toBe(0.25);
    expect(charCost("ك", "ق")).toBe(0.25);
    expect(charCost("ط", "ق")).toBe(1);
  });
  it("harakat cost 0.1 against each other and 1 against letters", () => {
    expect(charCost("َ", "ُ")).toBe(0.1);
    expect(charCost("َ", "ب")).toBe(1);
    expect(charCost("ڇ", "َ")).toBe(0.25);
  });
  it("the table agrees with charCost", () => {
    const t = costTable();
    for (const a of "بسصءاَُِڇۦي") {
      for (const b of "بسصءاَُِڇۦي") {
        expect(t.costOf(t.id(a), t.id(b))).toBeCloseTo(charCost(a, b), 6);
      }
    }
    expect(t.id("x")).toBe(t.unknownId);
  });
});
