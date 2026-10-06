import { describe, expect, it } from "vitest";
import { CONTACT_EMAIL, contactHref, debugFacts, deviceSummary } from "../src/contact.js";
import { Prefs } from "../src/prefs.js";

describe("contactHref", () => {
  const href = contactHref("ملقّن القرآن", ["version: 3.1.0", "device: iPhone · iOS 18.5 · Safari 18.5"]);
  const url = new URL(href);

  it("writes to the published address with the app's name as the subject", () => {
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(CONTACT_EMAIL);
    expect(url.searchParams.get("subject")).toBe("ملقّن القرآن");
  });

  it("leaves room to write, then a rule, then the facts", () => {
    const lines = url.searchParams.get("body")!.split("\r\n");
    expect(lines.slice(0, 4)).toEqual(["", "", "", ""]);
    expect(lines[4]).toMatch(/^_{10,}$/);
    expect(lines.slice(5)).toEqual(["version: 3.1.0", "device: iPhone · iOS 18.5 · Safari 18.5"]);
  });
});

describe("debugFacts", () => {
  it("names the build, the device, the mode and the place", () => {
    const facts = debugFacts(new Prefs(), { version: "3.1.0", model: "3175583", data: "24360c05" });
    const text = facts.join("\n");
    expect(facts[0]).toBe("version: 3.1.0");
    expect(facts[1]).toMatch(/^device: /);
    expect(text).toMatch(/^mode: \w+$/m);
    expect(text).toMatch(/^last place: \d+:\d+$/m);
    expect(text).toMatch(/^model: 3175583 · data: 24360c05$/m);
    expect(text).toMatch(/^user agent: /m);
  });
});

describe("deviceSummary", () => {
  const cases: [string, string, number?][] = [
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      "iPhone · iOS 18.5 · Safari 18.5",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
      "iPhone · iOS 17.4.1 · Chrome 124.0",
    ],
    // An iPad asking for the desktop site says Macintosh; its touch screen does not.
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
      "iPad · iPadOS · Safari 18.2",
      5,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
      "Mac · macOS 10.15.7 · Safari 18.2",
      0,
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.53 Mobile Safari/537.36",
      "Pixel 8 · Android 14 · Chrome 125.0",
    ],
    // Chrome's reduced user agent: every phone is "K".
    [
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      "Android device · Android 10 · Chrome 126.0",
    ],
    [
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      "SM-S918B · Android 13 · Samsung Internet 25.0",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87",
      "PC · Windows · Edge 126.0",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "PC · Linux · Firefox 127.0"],
  ];
  for (const [ua, want, touch] of cases) {
    it(want, () => expect(deviceSummary(ua, touch ?? 0)).toBe(want));
  }
});
