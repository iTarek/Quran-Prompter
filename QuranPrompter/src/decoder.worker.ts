import { installDecoderWorker } from "@alketab/quran-engine/browser";

installDecoderWorker(self as unknown as DedicatedWorkerGlobalScope, () => import("onnxruntime-web/wasm"));
