import { afterEach, describe, expect, it } from "vitest";
import { Animator } from "../src/ui/orb.js";

/** The private frame and state, reached for directly: this is the loop's arithmetic under test. */
type Inside = { frame(ms: number): void; level: number; floorDb: number; slicesAt: number; lastT: number };
const inside = (a: Animator) => a as unknown as Inside;

/** A 480 ms chunk as 12 slices, all at one RMS. */
const chunk = (rms: number) => new Array<number>(12).fill(rms);

describe("Animator level", () => {
  const animators: Animator[] = [];
  const make = () => {
    const a = new Animator();
    a.setScene("listening");
    animators.push(a);
    return a;
  };
  // Stop every loop the tests started: "still" draws nothing and schedules nothing.
  afterEach(() => animators.splice(0).forEach((a) => a.setScene("still")));

  // A frame's timestamp is when the frame BEGAN and can come a moment before
  // the chunk arrived; the negative slice index made the level NaN, for good,
  // and the orb stopped drawing mid-recitation.
  it("stays a number when a frame is stamped before the chunk arrived", () => {
    const a = make();
    a.hear(chunk(0.05));
    const at = inside(a).slicesAt;
    inside(a).frame(at - 8);
    expect(Number.isFinite(inside(a).level)).toBe(true);
    inside(a).frame(at + 20);
    expect(Number.isFinite(inside(a).level)).toBe(true);
  });

  it("rises well clear of its own breathing for ordinary recitation", () => {
    const a = make();
    a.hear(chunk(0.001)); // the room: -60 dBFS
    // Recitation ~30 dB over the room, with the short gaps real speech has —
    // the gaps are what keep the room's level learned. One frame per chunk, on
    // a clock of its own so the easing sees real time pass.
    const speech = [...new Array<number>(9).fill(0.03), 0.001, 0.001, 0.001];
    let now = 10_000;
    for (let i = 0; i < 10; i++) {
      a.hear(speech);
      inside(a).slicesAt = now;
      inside(a).frame(now + 16);
      now += 480;
    }
    // Breathing while listening is 0.15-0.22; the old fixed scale (RMS × 5)
    // put this voice at 0.15 — no higher than the breathing.
    expect(inside(a).level).toBeGreaterThan(0.45);
  });

  it("learns the room from quiet moments but not from the app muting its own sound", () => {
    const a = make();
    a.hear(chunk(0.001));
    const floor = inside(a).floorDb;
    expect(floor).toBeCloseTo(-60, 0);
    a.hear(chunk(0)); // exact silence: the app's own cue muted out
    expect(inside(a).floorDb).toBeGreaterThanOrEqual(floor);
  });

  // A 90 or 120 Hz display asks for a frame that often; the orb draws ~60 a
  // second whatever the display runs at. `lastT` moves only on a drawn frame.
  for (const hz of [60, 90, 120, 144]) {
    it(`draws about 60 times a second on a ${hz} Hz display`, () => {
      const a = make();
      let drawn = 0;
      let last = -1;
      for (let i = 0; i < hz; i++) {
        inside(a).frame(1000 + (i * 1000) / hz);
        if (inside(a).lastT !== last) {
          drawn++;
          last = inside(a).lastT;
        }
      }
      if (hz === 60) expect(drawn).toBe(60);
      else {
        expect(drawn).toBeGreaterThanOrEqual(55);
        expect(drawn).toBeLessThanOrEqual(64);
      }
    });
  }
});
