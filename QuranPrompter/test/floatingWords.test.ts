import { beforeAll, describe, expect, it } from "vitest";
import { ListenScreen } from "../src/ui/listen.js";
import type { Animator } from "../src/ui/orb.js";

// happy-dom lays nothing out and has no Web Animations: give the layer a
// phone's size, and let `animate` be a no-op. What is under test is which
// words float, not how they move.
beforeAll(() => {
  if (!Element.prototype.animate) {
    Element.prototype.animate = function () {
      return {} as Animation;
    };
  }
});

function screen(): ListenScreen {
  const s = new ListenScreen({ attach() {} } as unknown as Animator);
  s.el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(s.el);
  return s;
}
const floating = (s: ListenScreen) => s.el.querySelectorAll(".floats .fw").length;
const words = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ key: from + i, text: `w${from + i}` }));

describe("the words heard, rising behind the orb", () => {
  it("float only while the orb is up", () => {
    const s = screen();
    s.float(words(0, 3));
    expect(floating(s)).toBe(0);
    s.show(true);
    s.float(words(0, 3));
    expect(floating(s)).toBe(3);
  });

  // The guess is re-sent as it grows; a word floats once per search.
  it("float each word once, however often the guess repeats it", () => {
    const s = screen();
    s.show(true);
    s.float(words(0, 3));
    s.float(words(0, 5));
    expect(floating(s)).toBe(5);
  });

  it("keep at most twenty, the oldest going first", () => {
    const s = screen();
    s.show(true);
    s.float(words(0, 25));
    expect(floating(s)).toBe(20);
    expect(s.el.querySelector(".floats .fw")!.textContent).toBe("w5");
  });

  it("stop once the place is found", () => {
    const s = screen();
    s.show(true);
    s.float(words(0, 2));
    s.found("الرحمن", 1);
    s.float(words(10, 3));
    expect(floating(s)).toBe(2);
  });

  it("start afresh with a new search: the old ones gone, every word free to float again", () => {
    const s = screen();
    s.show(true);
    s.float(words(0, 4));
    s.show(false);
    s.show(true);
    expect(floating(s)).toBe(0);
    s.float(words(0, 4));
    expect(floating(s)).toBe(4);
  });

  it("are left alone by a repeated show of a layer already up", () => {
    const s = screen();
    s.show(true);
    s.float(words(0, 3));
    s.show(true);
    expect(floating(s)).toBe(3);
  });
});
