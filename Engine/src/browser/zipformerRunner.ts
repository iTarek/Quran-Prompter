import type * as OrtTypes from "onnxruntime-web/wasm";
import modelIO from "../model/zipformer-io.json" with { type: "json" };

type Ort = typeof OrtTypes;

export interface ZipformerIO {
  model: string;
  T: number;
  hop: number;
  featureDim: number;
  vocabSize: number;
  inputs: { name: string; dims: number[]; dtype: "float32" | "int64" }[];
}

export const ZIPFORMER_IO = modelIO as ZipformerIO;

/**
 * Streams fbank frames through the k2 streaming zipformer2-CTC export with
 * onnxruntime-web: `x [1, T, 80]` plus every cache tensor, zero-initialised
 * from the committed I/O manifest, each `cached_*` replaced by the model's
 * `new_cached_*` after every call. The loop is the one in
 * `Scripts/margin_probe.py`: a window of T=61 frames, advanced by hop=48.
 *
 * Refuses a model whose outputs do not carry a `new_<name>` for every state
 * input — a silently frozen cache would degrade every chunk after the first.
 */
export class ZipformerRunner {
  private readonly ort: Ort;
  private readonly session: OrtTypes.InferenceSession;
  readonly io: ZipformerIO;
  private states = new Map<string, OrtTypes.Tensor>();
  private frames: Float32Array[] = [];

  private constructor(ort: Ort, session: OrtTypes.InferenceSession, io: ZipformerIO) {
    this.ort = ort;
    this.session = session;
    this.io = io;
    this.validate();
    this.resetStates();
  }

  static async create(ort: Ort, model: ArrayBuffer | Uint8Array | string, io: ZipformerIO = ZIPFORMER_IO): Promise<ZipformerRunner> {
    const session = await ort.InferenceSession.create(model as never, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    return new ZipformerRunner(ort, session, io);
  }

  private validate(): void {
    const inputs = new Set(this.session.inputNames);
    const outputs = new Set(this.session.outputNames);
    if (!inputs.has("x")) throw new Error("model has no input 'x'");
    if (!outputs.has("log_probs")) throw new Error("model has no output 'log_probs'");
    for (const inp of this.io.inputs) {
      if (inp.name === "x") continue;
      if (!inputs.has(inp.name)) throw new Error(`model lacks state input ${inp.name}`);
      if (!outputs.has(`new_${inp.name}`)) throw new Error(`model lacks new_${inp.name}`);
    }
    for (const name of this.session.inputNames) {
      if (name !== "x" && !this.io.inputs.some((i) => i.name === name)) throw new Error(`manifest lacks model input ${name}`);
    }
  }

  private resetStates(): void {
    this.states.clear();
    for (const inp of this.io.inputs) {
      if (inp.name === "x") continue;
      const size = inp.dims.reduce((a, b) => a * b, 1);
      const data = inp.dtype === "int64" ? new BigInt64Array(size) : new Float32Array(size);
      this.states.set(inp.name, new this.ort.Tensor(inp.dtype, data, inp.dims));
    }
  }

  reset(): void {
    this.resetStates();
    this.frames = [];
  }

  /**
   * Buffers fbank frames and runs every complete window. Returns the
   * concatenated log-probs of the chunks run (`frames × vocabSize`).
   */
  async accept(frames: Float32Array[]): Promise<{ logProbs: Float32Array; frames: number }> {
    for (const f of frames) this.frames.push(f);
    const { T, hop, featureDim, vocabSize } = this.io;
    const outs: Float32Array[] = [];
    let total = 0;
    while (this.frames.length >= T) {
      const x = new Float32Array(T * featureDim);
      for (let t = 0; t < T; t++) x.set(this.frames[t], t * featureDim);
      const feeds: Record<string, OrtTypes.Tensor> = { x: new this.ort.Tensor("float32", x, [1, T, featureDim]) };
      for (const [name, tensor] of this.states) feeds[name] = tensor;
      const result = await this.session.run(feeds);
      const lp = result["log_probs"];
      const dims = lp.dims;
      if (dims.length !== 3 || dims[2] !== vocabSize) throw new Error(`log_probs dims ${dims.join("x")}`);
      const data = lp.data as Float32Array;
      outs.push(data);
      total += dims[1];
      for (const name of [...this.states.keys()]) {
        const next = result[`new_${name}`];
        if (!next) throw new Error(`model returned no new_${name}`);
        this.states.set(name, next);
      }
      this.frames.splice(0, hop);
    }
    if (outs.length === 1) return { logProbs: outs[0], frames: total };
    const all = new Float32Array(total * vocabSize);
    let off = 0;
    for (const o of outs) {
      all.set(o, off);
      off += o.length;
    }
    return { logProbs: all, frames: total };
  }
}
