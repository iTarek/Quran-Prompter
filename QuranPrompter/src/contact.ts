import { lang } from "./lang.js";
import type { Prefs } from "./prefs.js";

/** Where «تواصل معنا» writes to — the same address the privacy page gives. */
export const CONTACT_EMAIL = "info@iPhoneIslam.com";

/** The build's own versions, baked in by vite.config.ts. */
export interface BuildInfo {
  version: string;
  model: string;
  data: string;
}

/**
 * The `mailto:` link behind «تواصل معنا»: the app's name as the subject, room
 * at the top to write, then a rule and the facts a bug report always needs and
 * a reciter never knows to include — which build, which device, which mode.
 */
export function contactHref(subject: string, facts: readonly string[]): string {
  // Four empty lines to write in, then the rule. CRLF, as RFC 6068 has it.
  const body = ["", "", "", "", "__________________________", ...facts].join("\r\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Everything worth knowing about the sitting that wrote the message, read at
 * the moment the button is pressed. In English whatever the interface is in:
 * it is read by whoever fixes the bug, not by the reciter.
 */
export function debugFacts(prefs: Prefs, build: BuildInfo): string[] {
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  const offline = "serviceWorker" in nav && nav.serviceWorker.controller !== null;
  const place = prefs.lastRead;
  const onOff = (v: boolean) => (v ? "on" : "off");
  return [
    `version: ${build.version}`,
    `device: ${deviceSummary(nav.userAgent, nav.maxTouchPoints)}`,
    `mode: ${prefs.mode}`,
    `language: ${lang()} (browser: ${nav.language})`,
    `last place: ${place.surah}:${place.ayah}`,
    `text size: ${Math.round(prefs.fontMulti * 100)}%`,
    `latin readings: ${onOff(prefs.translit)} · mistake sound: ${onOff(prefs.mistakeSound)}`,
    `installed: ${installed ? "yes" : "no"} · offline copy: ${offline ? "yes" : "no"}`,
    `screen: ${screen.width}×${screen.height} @${devicePixelRatio}x · window: ${innerWidth}×${innerHeight}`,
    // Without cross-origin isolation the decoder quietly runs on one thread.
    `threads: ${globalThis.crossOriginIsolated ? "yes" : "no"} (${nav.hardwareConcurrency || "?"} cores)`,
    `model: ${build.model} · data: ${build.data}`,
    `user agent: ${nav.userAgent}`,
  ];
}

/**
 * «iPhone · iOS 18.5 · Safari 18.5» — device, system and browser, read from
 * the user agent. An iPad asking for the desktop site calls itself a Mac; the
 * touch screen gives it away.
 */
export function deviceSummary(ua: string, touchPoints = 0): string {
  const dotted = (m: RegExpMatchArray | null) => (m ? m[1].replace(/_/g, ".") : "");
  const ios = dotted(ua.match(/OS (\d+[_.]\d+(?:[_.]\d+)?) like Mac OS X/));
  let device: string;
  let os: string;
  if (/iPhone/.test(ua)) {
    device = "iPhone";
    os = `iOS ${ios}`;
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1)) {
    device = "iPad";
    os = `iPadOS ${ios}`;
  } else if (/Android/.test(ua)) {
    const m = ua.match(/Android ([\d.]+)(?:; ([^;)]+))?/);
    const model = (m?.[2] ?? "").replace(/ Build\/.*/, "").trim();
    // Chrome's reduced user agent names every phone "K": that is no model.
    device = model && model !== "K" ? model : "Android device";
    os = `Android ${m?.[1] ?? ""}`;
  } else if (/Mac OS X/.test(ua)) {
    device = "Mac";
    os = `macOS ${dotted(ua.match(/Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/))}`;
  } else if (/Windows NT/.test(ua)) {
    device = "PC";
    os = "Windows";
  } else if (/Linux|CrOS/.test(ua)) {
    device = "PC";
    os = /CrOS/.test(ua) ? "ChromeOS" : "Linux";
  } else {
    device = "unknown device";
    os = "";
  }
  return [device, os.trim(), browserName(ua)].filter(Boolean).join(" · ");
}

/** Most specific first: every Chromium browser also says "Chrome", and iOS's all say "Safari". */
const BROWSERS: readonly [RegExp, string][] = [
  [/EdgiOS\/([\d.]+)/, "Edge"],
  [/EdgA?\/([\d.]+)/, "Edge"],
  [/CriOS\/([\d.]+)/, "Chrome"],
  [/FxiOS\/([\d.]+)/, "Firefox"],
  [/SamsungBrowser\/([\d.]+)/, "Samsung Internet"],
  [/OPR\/([\d.]+)/, "Opera"],
  [/Firefox\/([\d.]+)/, "Firefox"],
  [/Chrome\/([\d.]+)/, "Chrome"],
  [/Version\/([\d.]+).*Safari/, "Safari"],
];

function browserName(ua: string): string {
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1].split(".").slice(0, 2).join(".")}`;
  }
  return "";
}
