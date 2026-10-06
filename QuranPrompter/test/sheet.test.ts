import { describe, expect, it, vi } from "vitest";
import { surahSheet } from "../src/ui/sheets.js";
import { loadCorpus } from "./helpers.js";

function open(): HTMLDialogElement {
  const sheet = surahSheet(loadCorpus(), null, vi.fn());
  document.body.appendChild(sheet);
  sheet.showModal();
  return sheet;
}

/** A press that goes down on `down` and is released as a click on `up`. */
function press(down: Element, up: Element): void {
  down.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("bottom sheet", () => {
  it("closes on a press that starts and ends on the backdrop", () => {
    const sheet = open();
    press(sheet, sheet);
    expect(sheet.open).toBe(false);
    expect(sheet.isConnected).toBe(false);
  });

  // Selecting text in the search box and letting go outside the sheet
  // produces a click on the dialog itself — and closed the index mid-search.
  it("stays open when a press inside ends outside", () => {
    const sheet = open();
    const input = sheet.querySelector("input")!;
    press(input, sheet);
    expect(sheet.open).toBe(true);
    sheet.close();
  });

  it("stays open for a click inside the sheet", () => {
    const sheet = open();
    const list = sheet.querySelector(".surahlist")!;
    press(list, list);
    expect(sheet.open).toBe(true);
    sheet.close();
  });
});
