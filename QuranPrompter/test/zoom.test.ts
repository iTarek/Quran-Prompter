import { beforeAll, describe, expect, it } from "vitest";
import { lockPageZoom } from "../src/zoom.js";

/** Dispatch a cancelable event at the body; true when something prevented it. */
function prevented(e: Event): boolean {
  document.body.dispatchEvent(e);
  return e.defaultPrevented;
}

/** A touchmove carrying `fingers` touches — only `touches.length` is read. */
function touchmove(fingers: number): Event {
  const e = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: { length: fingers } });
  return e;
}

describe("lockPageZoom", () => {
  beforeAll(() => lockPageZoom());

  it("blocks Safari's pinch gesture", () => {
    for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
      expect(prevented(new Event(type, { bubbles: true, cancelable: true }))).toBe(true);
    }
  });

  it("blocks a two-finger move, and leaves a one-finger scroll alone", () => {
    expect(prevented(touchmove(2))).toBe(true);
    expect(prevented(touchmove(1))).toBe(false);
  });

  it("blocks ctrl+wheel (a trackpad pinch in Chrome), and leaves plain scrolling alone", () => {
    // happy-dom's WheelEvent does not carry modifier keys (`ctrlKey` is
    // undefined whatever the init says), so the flag is set on the event.
    const wheel = (ctrlKey: boolean) => {
      const e = new Event("wheel", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "ctrlKey", { value: ctrlKey });
      return e;
    };
    expect(prevented(wheel(true))).toBe(true);
    expect(prevented(wheel(false))).toBe(false);
  });

  it("blocks the keyboard's zoom, and nothing else the keyboard does", () => {
    for (const key of ["+", "=", "-", "0"]) {
      expect(prevented(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key }))).toBe(true);
      expect(prevented(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, metaKey: true, key }))).toBe(true);
    }
    expect(prevented(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "0" }))).toBe(false);
    expect(prevented(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "c" }))).toBe(false);
  });
});
