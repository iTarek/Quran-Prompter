import type { HeardToken } from "../core/types.js";
import type { DecoderRequest, DecoderResponse } from "./decoderWorker.js";

export interface DecoderClientOptions {
  modelUrl: string;
  /** Base URL of the onnxruntime-web wasm files. Omit to let the bundle load its own copy. */
  wasmPaths?: string;
  numThreads?: number;
  onTokens: (tokens: HeardToken[], framesDecoded: number, decodeMs: number) => void;
  onProgress?: (loaded: number, total: number) => void;
  onError?: (message: string) => void;
}

/** Main-thread handle on the decoder worker. */
export class DecoderClient {
  private readonly worker: Worker;
  private readonly opts: DecoderClientOptions;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (e: Error) => void;
  private _ready = false;

  constructor(worker: Worker, opts: DecoderClientOptions) {
    this.worker = worker;
    this.opts = opts;
    this.readyPromise = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });
    worker.onmessage = (ev: MessageEvent<DecoderResponse>) => {
      const m = ev.data;
      switch (m.type) {
        case "ready":
          this._ready = true;
          this.resolveReady();
          break;
        case "progress":
          opts.onProgress?.(m.loaded, m.total);
          break;
        case "tokens":
          opts.onTokens(m.tokens, m.framesDecoded, m.decodeMs);
          break;
        case "failed":
          if (!this._ready) this.rejectReady(new Error(m.message));
          opts.onError?.(m.message);
          break;
      }
    };
    worker.onerror = (e) => {
      const msg = e.message || "decoder worker crashed";
      if (!this._ready) this.rejectReady(new Error(msg));
      opts.onError?.(msg);
    };
  }

  /** Loads the model; resolves when the first chunk can be decoded. */
  init(): Promise<void> {
    this.send({ type: "init", modelUrl: this.opts.modelUrl, wasmPaths: this.opts.wasmPaths, numThreads: this.opts.numThreads });
    return this.readyPromise;
  }

  get ready(): boolean {
    return this._ready;
  }

  /** 16 kHz mono samples; the buffer is transferred, not copied. */
  pushAudio(samples: Float32Array): void {
    this.worker.postMessage({ type: "audio", samples } satisfies DecoderRequest, [samples.buffer]);
  }

  reset(): void {
    this.send({ type: "reset" });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(req: DecoderRequest): void {
    this.worker.postMessage(req);
  }
}
