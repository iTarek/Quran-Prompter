/**
 * Microphone → 16 kHz mono Float32 chunks of 480 ms (7680 samples).
 *
 * Echo cancellation, noise suppression and AGC are turned OFF: they attenuate
 * exactly the soft onsets and long vowels the model needs (the iOS engine
 * measured the same with Apple's voice processing). If the browser refuses a
 * 16 kHz AudioContext (Safari, some hardware), the worklet resamples from the
 * native rate with a windowed-sinc low-pass + linear interpolation.
 */
export interface MicCaptureOptions {
  /** Samples per chunk at 16 kHz. Default 7680 (480 ms — one model hop). */
  chunkSamples?: number;
  onChunk: (samples: Float32Array) => void;
  onLevel?: (rms: number) => void;
  /** Fires once when the first chunk arrives — the mic is provably hot. */
  onLive?: () => void;
}

const TARGET_RATE = 16_000;

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = options.processorOptions || {};
    this.chunk = p.chunkSamples || 7680;
    this.ratio = sampleRate / ${TARGET_RATE};
    this.buf = new Float32Array(this.chunk);
    this.fill = 0;
    this.phase = 0;
    // Windowed-sinc low-pass for the resampling case (cutoff 7.2 kHz at 16 kHz).
    if (this.ratio !== 1) {
      const taps = 31;
      const fc = 7200 / sampleRate;
      const h = new Float32Array(taps);
      let sum = 0;
      for (let i = 0; i < taps; i++) {
        const n = i - (taps - 1) / 2;
        const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
        const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
        h[i] = sinc * w;
        sum += h[i];
      }
      for (let i = 0; i < taps; i++) h[i] /= sum;
      this.h = h;
      this.hist = new Float32Array(taps - 1);
      this.tail = 0;
    }
  }
  push(v) {
    this.buf[this.fill++] = v;
    if (this.fill === this.chunk) {
      let e = 0;
      for (let i = 0; i < this.chunk; i++) e += this.buf[i] * this.buf[i];
      const out = this.buf;
      this.port.postMessage({ samples: out, rms: Math.sqrt(e / this.chunk) }, [out.buffer]);
      this.buf = new Float32Array(this.chunk);
      this.fill = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.ratio === 1) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i]);
      return true;
    }
    // Low-pass then pick samples at the target rate by linear interpolation.
    const taps = this.h.length;
    const ext = new Float32Array(this.hist.length + ch.length);
    ext.set(this.hist, 0);
    ext.set(ch, this.hist.length);
    const filtered = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += this.h[k] * ext[i + k];
      filtered[i] = acc;
    }
    this.hist.set(ext.subarray(ext.length - this.hist.length));
    while (this.phase < filtered.length - 1) {
      const i = Math.floor(this.phase);
      const f = this.phase - i;
      // After the previous block, phase can carry as low as -1, so the first
      // output of this block may sit between that block's last sample and this
      // block's first. Reading filtered[-1] would be undefined -> NaN, and NaN
      // features decode as silence with no error anywhere.
      const a = i < 0 ? this.tail : filtered[i];
      this.push(a * (1 - f) + filtered[i + 1] * f);
      this.phase += this.ratio;
    }
    this.tail = filtered[filtered.length - 1];
    this.phase -= filtered.length;
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export class MicCapture {
  private readonly opts: MicCaptureOptions;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private _live = false;
  private _sampleRate = 0;

  constructor(opts: MicCaptureOptions) {
    this.opts = opts;
  }

  /** The AudioContext rate actually granted (16000 unless resampling). */
  get sampleRate(): number {
    return this._sampleRate;
  }

  get running(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: TARGET_RATE,
      },
    });
    this.stream = stream;
    // Everything past this point can throw — a browser without AudioWorklet, a
    // context that will not resume, a blob URL blocked by CSP. Without this
    // guard the granted stream stays open: the browser keeps showing its
    // recording indicator while no session exists to stop it.
    try {
      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: TARGET_RATE });
      } catch {
        context = new AudioContext();
      }
      this.context = context;
      this._sampleRate = context.sampleRate;
      // Logged on every browser, not just the resampling ones: the Safari
      // fallback is only checkable by a human opening the console, and no line
      // at all is indistinguishable from a check that was never wired.
      console.info(
        `[quran-engine] microphone at ${context.sampleRate} Hz` +
          (context.sampleRate === TARGET_RATE ? "" : ` → resampling to ${TARGET_RATE}`),
      );
      if (context.state === "suspended") await context.resume();
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: { chunkSamples: this.opts.chunkSamples ?? 7680 },
      });
      node.port.onmessage = (ev: MessageEvent<{ samples: Float32Array; rms: number }>) => {
        if (!this._live) {
          this._live = true;
          this.opts.onLive?.();
        }
        this.opts.onLevel?.(ev.data.rms);
        this.opts.onChunk(ev.data.samples);
      };
      this.node = node;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(node);
      // The worklet needs a destination to be pulled; it outputs silence.
      node.connect(context.destination);
    } catch (err) {
      await this.stop();
      throw err;
    }
  }

  async stop(): Promise<void> {
    this._live = false;
    this.source?.disconnect();
    this.node?.disconnect();
    this.node = null;
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ctx = this.context;
    this.context = null;
    if (ctx) await ctx.close().catch(() => undefined);
  }
}
