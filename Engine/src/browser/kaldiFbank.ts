/**
 * Online kaldi-compatible log-mel filterbank — the exact feature frontend
 * the zipformer was trained with (torchaudio.compliance.kaldi.fbank / knf):
 * 16 kHz, 25 ms povey window, 10 ms shift, snip_edges=false, dither 0,
 * remove_dc_offset, preemphasis 0.97, 80 mel bins, low 20 Hz, high −400
 * (= 7600 Hz), log of power-spectrum mel energies.
 *
 * A line-for-line port of the iOS engine's `KaldiFbank.swift`, which was
 * verified frame-for-frame against kaldi-native-fbank. The model card warns
 * that a near-miss frontend (Slaney mel) silently doubles the error rate, so
 * any change here must re-verify against the Python reference
 * (`test/kaldiFbank.test.ts`).
 */
export class KaldiFbank {
  static readonly sampleRate = 16_000;
  static readonly frameLength = 400;
  static readonly frameShift = 160;
  static readonly numBins = 80;
  private static readonly fftSize = 512;
  private static readonly preemphasis = 0.97;

  private samples: Float32Array = new Float32Array(0);
  private sampleOffset = 0;
  private framesProduced = 0;

  private readonly window: Float32Array;
  private readonly melBins: { offset: number; weights: Float32Array }[];
  private readonly re = new Float64Array(KaldiFbank.fftSize);
  private readonly im = new Float64Array(KaldiFbank.fftSize);
  private readonly power = new Float64Array(KaldiFbank.fftSize / 2);
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly bitrev: Uint16Array;

  constructor() {
    const N = KaldiFbank.frameLength;
    this.window = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      this.window[i] = Math.pow(hann, 0.85);
    }
    this.melBins = KaldiFbank.makeMelBins();
    const F = KaldiFbank.fftSize;
    this.cosTable = new Float64Array(F / 2);
    this.sinTable = new Float64Array(F / 2);
    for (let k = 0; k < F / 2; k++) {
      this.cosTable[k] = Math.cos((2 * Math.PI * k) / F);
      this.sinTable[k] = Math.sin((2 * Math.PI * k) / F);
    }
    const bits = Math.log2(F);
    this.bitrev = new Uint16Array(F);
    for (let i = 0; i < F; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.bitrev[i] = r;
    }
  }

  /**
   * Appends samples ([-1, 1] mono 16 kHz) and returns every newly ready
   * frame. With snip_edges=false, frame f is centred at f·160+80 and spans
   * [f·160−120, f·160+280); it becomes ready once that end sample exists.
   * Start-of-stream negatives are reflected exactly as kaldi does.
   */
  acceptWaveform(newSamples: Float32Array): Float32Array[] {
    if (newSamples.length) {
      const merged = new Float32Array(this.samples.length + newSamples.length);
      merged.set(this.samples, 0);
      merged.set(newSamples, this.samples.length);
      this.samples = merged;
    }
    const out: Float32Array[] = [];
    while (this.frameEnd(this.framesProduced) <= this.sampleOffset + this.samples.length) {
      out.push(this.extractFrame(this.framesProduced, Number.MAX_SAFE_INTEGER));
      this.framesProduced++;
    }
    this.trim();
    return out;
  }

  /** Flushes end-of-stream frames (kaldi: total = (n + shift/2) / shift). */
  inputFinished(): Float32Array[] {
    const total = Math.floor((this.sampleOffset + this.samples.length + KaldiFbank.frameShift / 2) / KaldiFbank.frameShift);
    const out: Float32Array[] = [];
    while (this.framesProduced < total) {
      out.push(this.extractFrame(this.framesProduced, this.sampleOffset + this.samples.length));
      this.framesProduced++;
    }
    return out;
  }

  reset(): void {
    this.samples = new Float32Array(0);
    this.sampleOffset = 0;
    this.framesProduced = 0;
  }

  get frameCount(): number {
    return this.framesProduced;
  }

  private frameStart(f: number): number {
    return f * KaldiFbank.frameShift + KaldiFbank.frameShift / 2 - KaldiFbank.frameLength / 2;
  }

  private frameEnd(f: number): number {
    return this.frameStart(f) + KaldiFbank.frameLength;
  }

  private trim(): void {
    const needed = Math.max(0, this.frameStart(this.framesProduced));
    const drop = needed - this.sampleOffset;
    if (drop > 1600) {
      this.samples = this.samples.slice(drop);
      this.sampleOffset = needed;
    }
  }

  private extractFrame(f: number, totalAvailable: number): Float32Array {
    const N = KaldiFbank.frameLength;
    const frame = new Float64Array(N);
    const start = this.frameStart(f);
    for (let i = 0; i < N; i++) {
      let s = start + i;
      // kaldi edge reflection: −1 → 0, −2 → 1, n → n−1, n+1 → n−2 …
      while (s < 0 || s >= totalAvailable) {
        if (s < 0) s = -s - 1;
        else s = 2 * totalAvailable - 1 - s;
      }
      frame[i] = this.samples[s - this.sampleOffset];
    }
    // remove_dc_offset
    let mean = 0;
    for (let i = 0; i < N; i++) mean += frame[i];
    mean /= N;
    for (let i = 0; i < N; i++) frame[i] -= mean;
    // Preemphasis, in reverse exactly as kaldi (frame[0] uses itself).
    for (let i = N - 1; i >= 1; i--) frame[i] -= KaldiFbank.preemphasis * frame[i - 1];
    frame[0] -= KaldiFbank.preemphasis * frame[0];
    for (let i = 0; i < N; i++) frame[i] *= this.window[i];

    // Zero-padded 512-point FFT → power spectrum (plain DFT scaling).
    const F = KaldiFbank.fftSize;
    const { re, im, bitrev, cosTable, sinTable, power } = this;
    for (let i = 0; i < F; i++) {
      const src = bitrev[i];
      re[i] = src < N ? frame[src] : 0;
      im[i] = 0;
    }
    for (let size = 2; size <= F; size <<= 1) {
      const half = size >> 1;
      const step = F / size;
      for (let start = 0; start < F; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cosTable[k * step];
          const wi = -sinTable[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k < F / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];

    const mel = new Float32Array(KaldiFbank.numBins);
    for (let b = 0; b < KaldiFbank.numBins; b++) {
      const bin = this.melBins[b];
      let e = 0;
      for (let j = 0; j < bin.weights.length; j++) e += power[bin.offset + j] * bin.weights[j];
      mel[b] = Math.log(Math.max(e, 1.1920929e-7));
    }
    return mel;
  }

  private static melScale(freq: number): number {
    return 1127.0 * Math.log(1.0 + freq / 700.0);
  }

  /**
   * kaldi MelBanks: 80 triangular filters between 20 Hz and 7600 Hz
   * (high_freq = −400 → nyquist − 400), over 256 FFT bins (nyquist
   * excluded), stored sparse as (first bin, weights).
   */
  private static makeMelBins(): { offset: number; weights: Float32Array }[] {
    const lowMel = KaldiFbank.melScale(20);
    const highMel = KaldiFbank.melScale(KaldiFbank.sampleRate / 2 - 400);
    const delta = (highMel - lowMel) / (KaldiFbank.numBins + 1);
    const binWidth = KaldiFbank.sampleRate / KaldiFbank.fftSize;
    const bins: { offset: number; weights: Float32Array }[] = [];
    for (let b = 0; b < KaldiFbank.numBins; b++) {
      const left = lowMel + b * delta;
      const center = left + delta;
      const right = center + delta;
      let offset = -1;
      const weights: number[] = [];
      for (let k = 0; k < KaldiFbank.fftSize / 2; k++) {
        const mel = KaldiFbank.melScale(binWidth * k);
        if (!(mel > left && mel < right)) {
          if (offset >= 0) break;
          continue;
        }
        if (offset < 0) offset = k;
        weights.push(mel <= center ? (mel - left) / delta : (right - mel) / delta);
      }
      bins.push({ offset: Math.max(offset, 0), weights: Float32Array.from(weights) });
    }
    return bins;
  }
}
