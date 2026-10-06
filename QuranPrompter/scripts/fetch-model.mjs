#!/usr/bin/env node
// Puts the ASR model in public/models/ (72 MB, gitignored — it is never
// committed). The live site serves the same file, so QT_MODEL_URL always works.
//
//   QT_MODEL_URL=https://…/model.onnx npm run fetch-model  download it — the live
//       site serves the exact file: prompter.alketab.app/models/<NAME>
//   QT_MODEL=/path/to/model.onnx npm run fetch-model     copy from anywhere
//   npm run fetch-model                      copy from a Models/ directory three
//       levels up — a leftover from living inside the iOS workspace; it fails
//       with a message naming the two variables above.
import { copyFileSync, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const NAME = "quran_phoneme_zipformer.onnx";
const here = dirname(fileURLToPath(import.meta.url));
const dstDir = resolve(here, "../public/models");
const dst = resolve(dstDir, NAME);
mkdirSync(dstDir, { recursive: true });

const url = process.env.QT_MODEL_URL;
const src = process.env.QT_MODEL ?? resolve(here, "../../../Models", NAME);

if (url) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dst));
  console.log(`downloaded model (${statSync(dst).size} bytes) → public/models/`);
} else if (!existsSync(src)) {
  console.error(`model not found: ${src}`);
  console.error("Set QT_MODEL=/path/to/model.onnx or QT_MODEL_URL=https://… — see README, Quick start.");
  process.exit(1);
} else if (existsSync(dst) && statSync(dst).size === statSync(src).size) {
  console.log(`model already in place (${statSync(dst).size} bytes)`);
} else {
  copyFileSync(src, dst);
  console.log(`copied model (${statSync(dst).size} bytes) → public/models/`);
}
