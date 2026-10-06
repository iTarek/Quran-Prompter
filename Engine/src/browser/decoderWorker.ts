import type * as OrtTypes from "onnxruntime-web/wasm";
import { BLANK_ID, TOKENS } from "../model/tokens.js";
import type { HeardToken } from "../core/types.js";
import { GreedyCtcDecoder } from "./ctcDecoder.js";
import { KaldiFbank } from "./kaldiFbank.js";
import { ZipformerRunner } from "./zipformerRunner.js";

/** Messages the main thread sends to the decoder worker. */
export type DecoderRequest =
  | { type: "init"; modelUrl: string; wasmPaths?: string; numThreads?: number }
  | { type: "audio"; samples: Float32Array }
  | { type: "reset" };

/** Messages the decoder worker posts back. */
export type DecoderResponse =
  | { type: "ready" }
  | { type: "progress"; loaded: number; total: number }
  | { type: "tokens"; tokens: HeardToken[]; framesDecoded: number; decodeMs: number }
  | { type: "failed"; message: string };

/**
 * Installs the decoder in a Web Worker: fbank → onnxruntime-web → greedy
 * CTC, posting the tokens of every chunk with the running output-frame
 * count. The engine itself stays on the main thread.
 *
 * The host's worker file is two lines:
 *   import { installDecoderWorker } from "@alketab/quran-engine/browser";
 *   installDecoderWorker(self as unknown as DedicatedWorkerGlobalScope);
 */
export function installDecoderWorker(scope: DedicatedWorkerGlobalScope, loadOrt: () => Promise<typeof OrtTypes>): void {
  let runner: ZipformerRunner | null = null;
  const fbank = new KaldiFbank();
  const decoder = new GreedyCtcDecoder(TOKENS, BLANK_ID);
  let busy: Promise<void> = Promise.resolve();
  const post = (m: DecoderResponse, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

  async function init(req: Extract<DecoderRequest, { type: "init" }>): Promise<void> {
    const ort = await loadOrt();
    if (req.wasmPaths) ort.env.wasm.wasmPaths = req.wasmPaths;
    const threads = req.numThreads ?? (scope.crossOriginIsolated ? Math.min(4, scope.navigator.hardwareConcurrency || 1) : 1);
    ort.env.wasm.numThreads = threads;
    const bytes = await fetchModel(req.modelUrl, (loaded, total) => post({ type: "progress", loaded, total }));
    runner = await ZipformerRunner.create(ort, bytes);
    post({ type: "ready" });
  }

  async function audio(samples: Float32Array): Promise<void> {
    if (!runner) return;
    const t0 = performance.now();
    const frames = fbank.acceptWaveform(samples);
    const { logProbs, frames: out } = await runner.accept(frames);
    if (out === 0) return;
    const tokens = decoder.consume(logProbs, out, runner.io.vocabSize);
    post({ type: "tokens", tokens, framesDecoded: decoder.framesDecoded, decodeMs: performance.now() - t0 });
  }

  scope.onmessage = (ev: MessageEvent<DecoderRequest>) => {
    const req = ev.data;
    busy = busy
      .then(async () => {
        switch (req.type) {
          case "init":
            await init(req);
            break;
          case "audio":
            await audio(req.samples);
            break;
          case "reset":
            fbank.reset();
            decoder.reset();
            runner?.reset();
            break;
        }
      })
      .catch((e: unknown) => post({ type: "failed", message: e instanceof Error ? e.message : String(e) }));
  };
}

/** Fetches the model, cached in the Cache API so a return visit costs nothing. */
async function fetchModel(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const cacheName = "quran-engine-model";
  let cache: Cache | null = null;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch {
    cache = null;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new Error(`${url} served HTML — the model is not deployed`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.length;
  }
  // Release the chunk list before the two biggest allocations that follow —
  // the cache copy and onnxruntime's own copy into the wasm heap. Holding it
  // costs a second full copy of the model at exactly the wrong moment, which
  // on a phone is the difference between loading and being killed.
  chunks.length = 0;
  if (cache) {
    try {
      // We just missed on this URL, and it carries the model's content hash,
      // so anything still in here is a superseded model. Drop it before
      // storing: otherwise every model update leaves another ~72 MB parked in
      // the user's storage quota forever.
      for (const stale of await cache.keys()) await cache.delete(stale);
      await cache.put(url, new Response(bytes, { headers: { "content-length": String(loaded) } }));
    } catch {
      /* quota — fine, it will download again next time */
    }
  }
  return bytes;
}
