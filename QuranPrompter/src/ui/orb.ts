import type { Mode } from "../prefs.js";
import { paletteStops, rgba } from "../theme.js";

/** Which screen is up, which decides what moves and how much. */
export type Scene = "landing" | "listening" | "found" | "reading" | "still";

/**
 * The one animation loop: the orb on the start screen, the larger orb while
 * listening, and the five-bar wave in the reading HUD.
 *
 * The drawing is the design's own (`drawOrb`, `drawMini`), ported unchanged.
 * Two things are not the prototype's:
 *
 * - **It listens to the real room.** The mockup moved on a sine wave; here the
 *   host reports each chunk's loudness in 40 ms slices, read as decibels over
 *   the room's own noise (`hear`, `voice`), so the rings move with the
 *   reciter's syllables and settle when they stop — the one visible proof
 *   that the microphone is hearing THEM.
 * - **It costs what the screen needs, and no more.** Nothing is drawn for a
 *   scene with no canvas on it, the loop stops when nothing moves, easing is
 *   by elapsed time rather than per frame, and the reading HUD's wave — up for
 *   an hour of Tarawih — runs at 20 fps instead of the display's 60 or 120.
 *   Reduced motion gets one still frame.
 */
export class Animator {
  private scene: Scene = "still";
  private mode: Mode = "reading";
  private hero: HTMLCanvasElement | null = null;
  private listen: HTMLCanvasElement | null = null;
  private mini: HTMLCanvasElement | null = null;
  private level = 0.15;
  private kickAmt = 0;
  /** The last chunk's loudness, slice by slice — see `hear`. */
  private slices: readonly number[] = [];
  private slicesAt = 0;
  /**
   * The room's own noise, in dBFS. The orb shows the voice ABOVE it: a phone
   * on a stand at arm's length, with no gain control, hears speech 15-30 dB
   * over its room, and a fixed scale either needed the reciter to be loud or
   * lit up for the fan.
   */
  private floorDb = -60;
  private raf = 0;
  /** The reading HUD's between-frames sleep — see `frame`. */
  private timer = 0;
  private lastT = 0;
  /** When the next frame is due — see `FRAME_MS`. */
  private nextDue = 0;
  private readonly still = matchMedia("(prefers-reduced-motion: reduce)");

  constructor() {
    this.still.addEventListener?.("change", () => this.wake());
  }

  attach(which: "hero" | "listen" | "mini", canvas: HTMLCanvasElement): void {
    this[which] = canvas;
    this.wake();
  }

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.wake();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.wake();
  }

  /** A jolt — the mode changed, a word landed. Decays on its own. */
  kick(amount = 1): void {
    this.kickAmt = Math.max(this.kickAmt, amount);
    this.wake();
  }

  /**
   * The loudness of the chunk the host just heard, slice by slice (RMS). They
   * are played back across the next chunk's length, so the orb moves with
   * the syllables — half a second late, which is how late the chunk is.
   */
  hear(slices: readonly number[]): void {
    this.slices = slices;
    this.slicesAt = performance.now();
    for (const rms of slices) {
      // Exact silence is the app muting its own sound, not the room.
      if (rms < 1e-6) continue;
      const db = 20 * Math.log10(rms);
      // Down at once to any quieter moment; up slowly, ~1 dB a second, so the
      // pause between two words finds the floor again, and a room that got
      // louder is learned in seconds. Capped, so even a loud room leaves the
      // voice something to show.
      this.floorDb = Math.min(-30, db < this.floorDb ? db : this.floorDb + 0.04);
    }
  }

  /**
   * One slice as the orb's level: nothing within 6 dB of the room's noise,
   * then linear to full at 46 dB above it. Measured over seven test
   * recordings: the median slice lands at 0.70, the 90th percentile at 0.89,
   * 9 % at the top — clear of the orb's own breathing (0.15-0.22) with room
   * left to move. The old fixed scale (RMS × 5) put the median at 0.23-0.49,
   * level with the breathing: only a loud voice showed at all.
   */
  private voice(rms: number): number {
    if (rms < 1e-6) return 0;
    const over = 20 * Math.log10(rms) - this.floorDb;
    return Math.min(1, Math.max(0, (over - 6) / 40));
  }

  /** Redraw now — the palette changed, or a canvas was resized. */
  redraw(): void {
    this.wake();
  }

  private wake(): void {
    if (this.raf) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    this.raf = requestAnimationFrame((ms) => this.frame(ms));
  }

  private frame(ms: number): void {
    this.raf = 0;
    // At most ~60 draws a second. A 90 or 120 Hz display asks for a frame
    // that often, and the rings drift too slowly for the difference to show —
    // so on those screens every other frame is skipped, half the drawing. A
    // running schedule rather than a gap since the last draw, so 90 Hz still
    // averages near 60 instead of dropping to 45. A 60 Hz display skips none.
    if (this.scene !== "still" && ms < this.nextDue - 4) {
      this.wake();
      return;
    }
    this.nextDue = Math.max(this.nextDue, ms - FRAME_MS) + FRAME_MS;
    const t = ms / 1000;
    const dt = this.lastT ? Math.min(0.1, t - this.lastT) : 1 / 60;
    this.lastT = t;
    const s = this.scene;
    if (s === "still") return;

    // The design eased 9 % per frame and decayed the kick 5 % per frame, both
    // at 60 fps. The same curves by the clock, so a slower frame rate moves
    // at the same speed rather than in slow motion.
    this.kickAmt *= Math.pow(0.95, dt * 60);
    const base = { landing: 0.14, listening: 0.3 + 0.14 * Math.abs(Math.sin(t * 1.7)) * Math.abs(Math.sin(t * 0.63)), found: 0.45, reading: 0.18 }[s];
    let target = base + this.kickAmt * 0.55;
    // A chunk is 480 ms of audio; after 700 ms without one the room is not
    // being heard, and the orb goes back to its own breathing.
    // A frame's timestamp is when the frame BEGAN, which can be a moment
    // before the chunk arrived: `since` may be slightly negative, and an index
    // of -1 made the level NaN — for good, and the orb stopped drawing.
    const since = Math.max(0, ms - this.slicesAt);
    if (s !== "landing" && since < 700 && this.slices.length) {
      const i = Math.min(this.slices.length - 1, Math.floor(since / (480 / this.slices.length)));
      target = Math.max(target * 0.5, this.voice(this.slices[i]));
    }
    // Quick to rise, slow to fall: a syllable should show at once, and the orb
    // should not collapse in the gap before the next one.
    const ease = target > this.level ? 0.3 : 0.09;
    this.level += (target - this.level) * (1 - Math.pow(1 - ease, dt * 60));

    const c = paletteStops();
    const reduce = this.still.matches;
    if (s === "landing" && this.hero) drawOrb(this.hero, reduce ? 0 : t, this.level, c, 5, this.mode);
    if ((s === "listening" || s === "found") && this.listen) drawOrb(this.listen, reduce ? 0 : t, this.level, c, 7, this.mode);
    if (s === "reading" && this.mini) drawMini(this.mini, reduce ? 0 : t, reduce ? 0.3 : this.level, c);
    if (reduce) return;
    // Reading: SLEEP between frames rather than spinning the display loop and
    // skipping draws — a 34 × 18 px wave at 20 fps is all the HUD needs, and
    // it is on screen for as long as the recitation lasts.
    if (s === "reading") this.timer = window.setTimeout(() => this.wake(), 50);
    else this.wake();
  }
}

/** The orb's frame budget: 60 a second, whatever the display runs at. */
const FRAME_MS = 1000 / 60;

/** Size the backing store to the element, at up to 2× for sharp lines. */
function fit(cv: HTMLCanvasElement): [CanvasRenderingContext2D | null, number, number, number] {
  const d = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * d);
  const h = Math.round(cv.clientHeight * d);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  return [cv.getContext("2d"), w, h, d];
}

/**
 * Rings of breathing noise around a soft glow. Recognize sends three ripples
 * outward, as a search does; praying slows and stills into eight petals;
 * review dashes the rings, as its words are dashed under.
 */
function drawOrb(cv: HTMLCanvasElement, t: number, lv: number, c: readonly string[], rings: number, mode: Mode): void {
  const [ctx, w, h, d] = fit(cv);
  if (!ctx || !w) return;
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * 0.28;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 1.8);
  g.addColorStop(0, rgba(c[1], 0.16 + lv * 0.22));
  g.addColorStop(0.55, rgba(c[2], 0.06 + lv * 0.08));
  g.addColorStop(1, rgba(c[2], 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  const lg = ctx.createLinearGradient(cx - base, cy - base, cx + base, cy + base);
  lg.addColorStop(0, c[0]);
  lg.addColorStop(0.5, c[1]);
  lg.addColorStop(1, c[2]);
  ctx.strokeStyle = lg;
  if (mode === "recognize") {
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.28 + k / 3) % 1;
      ctx.beginPath();
      ctx.arc(cx, cy, base * (1 + p * 0.75), 0, Math.PI * 2);
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.lineWidth = 1 * d;
      ctx.stroke();
    }
  }
  ctx.setLineDash(mode === "memorizing" ? [2 * d, 7 * d] : []);
  const pray = mode === "praying";
  const sp = pray ? 0.45 : 1;
  for (let i = 0; i < rings; i++) {
    ctx.beginPath();
    const N = 200;
    for (let j = 0; j <= N; j++) {
      const th = (j / N) * Math.PI * 2;
      const n = pray
        ? Math.cos(th * 8 + t * 0.25 + i * 0.4) * 0.6 + Math.sin(th * 4 - t * 0.3) * 0.25 * Math.sin(t * 0.5 + i)
        : Math.sin(th * 3 + t * 0.9 * sp + i * 0.7) * 0.5 + Math.sin(th * 5 - t * 1.3 * sp + i * 1.1) * 0.3 + Math.sin(th * 2 + t * 0.45 - i) * 0.2;
      const amp = pray ? 0.035 + 0.2 * lv : 0.05 + 0.3 * lv;
      const r = base * (1 + i * 0.055) + n * base * amp * (1 - i * 0.06);
      const x = cx + Math.cos(th) * r;
      const y = cy + Math.sin(th) * r;
      if (j) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.globalAlpha = Math.max(0.08, 0.85 - i * 0.12);
    ctx.lineWidth = (i === 0 ? 1.8 : 1.1) * d;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** Five bars in the palette's colours, standing as tall as the room is loud. */
function drawMini(cv: HTMLCanvasElement, t: number, lv: number, c: readonly string[]): void {
  const [ctx, w, h, d] = fit(cv);
  if (!ctx || !w) return;
  ctx.clearRect(0, 0, w, h);
  const n = 5;
  const bw = 3 * d;
  const gap = (w - n * bw) / (n - 1);
  for (let i = 0; i < n; i++) {
    const bh = Math.max(bw, h * (0.2 + 0.8 * lv * (0.55 + 0.45 * Math.sin(t * 9 + i * 1.4))));
    ctx.fillStyle = c[i % 3];
    const x = i * (bw + gap);
    const y = (h - bh) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, bw / 2);
    else ctx.rect(x, y, bw, bh);
    ctx.fill();
  }
}
