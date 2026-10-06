import { afterEach, describe, expect, it, vi } from "vitest";
import { FailureScreen } from "../src/ui/screens.js";

function button(screen: FailureScreen): HTMLButtonElement {
  return screen.el.querySelector<HTMLButtonElement>(".cta")!;
}

describe("FailureScreen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries in place for a failure a restart can fix", () => {
    const onRetry = vi.fn();
    const screen = new FailureScreen(onRetry, () => undefined);
    screen.show("interrupted");
    button(screen).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // The model never loaded: restarting listening cannot fetch it, and used to
  // take the screen away and leave an app that could hear nothing.
  it("reloads the page when the model could not be loaded", () => {
    const onRetry = vi.fn();
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
    const screen = new FailureScreen(onRetry, () => undefined);
    screen.show("modelUnavailable");
    button(screen).click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("offers no retry for a denied microphone, only the way out", () => {
    const onClose = vi.fn();
    const screen = new FailureScreen(() => undefined, onClose);
    screen.show("micDenied");
    expect(button(screen).hidden).toBe(true);
    screen.el.querySelector<HTMLButtonElement>(".roundbtn")!.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
