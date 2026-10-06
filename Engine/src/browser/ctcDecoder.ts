import type { HeardToken } from "../core/types.js";

/**
 * Greedy CTC decode of the zipformer's per-chunk log-probs, with the CTC
 * collapse state carried across chunk boundaries (a token spanning two
 * chunks must not emit twice) and a per-token confidence MARGIN taken at
 * the token's PEAK frame — `exp(p1) − exp(p2)` where the token was most
 * confident, never at its first (transition) frame, whose near-ties flip
 * for reasons that have nothing to do with the reciter.
 *
 * A token is emitted when its run ends (the next frame is blank or another
 * token), so its margin is final. Tokens are never revised afterwards — a
 * host never needs to retract.
 *
 * Ported from the iOS engine's `PhonemeCTCDecoder.swift`.
 */
export class GreedyCtcDecoder {
  readonly symbols: readonly string[];
  readonly blank: number;
  private previousBest: number;
  private frameIndex = 0;
  /** The current token run: its id, first frame and peak-frame probabilities. */
  private run: { id: number; frame: number; p1: number; p2: number } | null = null;

  constructor(symbols: readonly string[], blank: number) {
    this.symbols = symbols;
    this.blank = blank;
    this.previousBest = blank;
  }

  get framesDecoded(): number {
    return this.frameIndex;
  }

  reset(): void {
    this.previousBest = this.blank;
    this.frameIndex = 0;
    this.run = null;
  }

  /**
   * @param logProbs one chunk, `frames × classes` row-major (as onnxruntime returns it).
   */
  consume(logProbs: Float32Array, frames: number, classes: number): HeardToken[] {
    const out: HeardToken[] = [];
    for (let t = 0; t < frames; t++) {
      const row = t * classes;
      let best = 0;
      let second = 0;
      let bestV = -Infinity;
      let secondV = -Infinity;
      for (let c = 0; c < classes; c++) {
        const v = logProbs[row + c];
        if (v > bestV) {
          second = best;
          secondV = bestV;
          best = c;
          bestV = v;
        } else if (v > secondV) {
          second = c;
          secondV = v;
        }
      }
      if (best !== this.blank && best !== this.previousBest) {
        if (this.run) out.push(this.emit(this.run));
        this.run = { id: best, frame: this.frameIndex, p1: bestV, p2: secondV };
      } else if (best !== this.blank && best === this.previousBest && this.run && bestV > this.run.p1) {
        // Peak-frame margin: REPLACE while the same token keeps winning.
        this.run.p1 = bestV;
        this.run.p2 = secondV;
      } else if (best === this.blank && this.run) {
        out.push(this.emit(this.run));
        this.run = null;
      }
      this.previousBest = best;
      this.frameIndex++;
    }
    return out;
  }

  /** Emit whatever run is still open (end of stream). */
  flush(): HeardToken[] {
    if (!this.run) return [];
    const t = this.emit(this.run);
    this.run = null;
    this.previousBest = this.blank;
    return [t];
  }

  private emit(run: { id: number; frame: number; p1: number; p2: number }): HeardToken {
    return { sym: this.symbols[run.id] ?? "", frame: run.frame, margin: Math.exp(run.p1) - Math.exp(run.p2) };
  }
}
