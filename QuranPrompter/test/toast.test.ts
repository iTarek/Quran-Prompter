import { afterEach, describe, expect, it } from "vitest";
import { Toast } from "../src/ui/toast.js";
import { nextFrame } from "./helpers.js";

describe("Toast", () => {
  const toast = new Toast();
  afterEach(() => toast.hide());

  // A live region is only listened to once it is on the page: text written in
  // the same moment it arrives went unannounced by VoiceOver.
  it("joins the page empty, as a live region, and speaks a frame later", async () => {
    toast.show("انتهت السورة");
    const el = document.querySelector<HTMLDivElement>(".toast")!;
    expect(el.getAttribute("role")).toBe("status");
    expect(el.textContent).toBe("");
    await nextFrame();
    expect(el.textContent).toBe("انتهت السورة");
  });

  it("lets a newer toast replace an older one before either has spoken", async () => {
    toast.show("first");
    const first = document.querySelector<HTMLDivElement>(".toast")!;
    toast.show("second");
    await nextFrame();
    const all = document.querySelectorAll(".toast");
    expect(all.length).toBe(1);
    expect(all[0].textContent).toBe("second");
    expect(first.isConnected).toBe(false);
    expect(first.textContent).toBe("");
  });
});
