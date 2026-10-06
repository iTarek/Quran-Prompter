/**
 * Development aid: `?audio=/test/fatiha.wav` plays a file INTO the decoder
 * instead of the microphone, at real-time pace (or `&speed=4`), so the whole
 * pipeline can be exercised in a browser without anyone reciting.
 */
export interface DevAudio {
  url: string;
  speed: number;
}

export function devAudioFromLocation(): DevAudio | null {
  const p = new URLSearchParams(location.search);
  const url = p.get("audio");
  if (!url) return null;
  return { url, speed: Math.max(0.25, Number(p.get("speed") ?? 1) || 1) };
}

/** Decodes the file to 16 kHz mono Float32 samples. */
export async function loadDevAudio(url: string): Promise<Float32Array> {
  const bytes = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.arrayBuffer();
  });
  // Two passes, both needed: decodeAudioData resamples to the context rate but
  // keeps the file's channel count, so a stereo recording is still stereo here.
  // Rendering it through a 1-channel context is what downmixes it to the mono
  // the model expects. (`bytes` is detached by the decode and never read again.)
  const probe = new OfflineAudioContext(1, 1, 16000);
  const decoded = await probe.decodeAudioData(bytes);
  const length = Math.ceil((decoded.duration + 1) * 16000);
  const ctx = new OfflineAudioContext(1, length, 16000);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0).slice(0);
}

/** Feeds 480 ms chunks on a timer; after the file, silence keeps flowing like a live mic would. */
export function playDevAudio(samples: Float32Array, speed: number, push: (chunk: Float32Array) => void, onLive: () => void): () => void {
  const chunk = 7680;
  let i = 0;
  let live = false;
  const timer = window.setInterval(() => {
    const part = new Float32Array(chunk);
    if (i < samples.length) part.set(samples.subarray(i, Math.min(samples.length, i + chunk)));
    i += chunk;
    if (!live) {
      live = true;
      onLive();
    }
    push(part);
  }, 480 / speed);
  return () => clearInterval(timer);
}
