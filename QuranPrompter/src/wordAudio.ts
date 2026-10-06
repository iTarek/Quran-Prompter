import { audioOut, audioReady } from "./audioOut.js";

/** A word by its coordinates. `position` is 1-based, as the CDN counts. */
export interface WordRef {
  surah: number;
  ayah: number;
  position: number;
}

/**
 * Says one word aloud, from Quran.com's word-by-word recitation.
 *
 * **The one thing in this app that needs the network.** Everything else — the
 * model, the corpus, the page — is on the device, and a word never played
 * before simply will not sound when offline. Words that HAVE played are kept
 * decoded, so a second press is instant and works with no network at all.
 *
 * **Only one word sounds at a time.** Pressing another stops the first, which
 * is also what clears its underline: `onChange` fires with the new word, or
 * with null when nothing is playing.
 */
export class WordAudio {
  /** Decoded clips by `surah:ayah:position`. */
  private readonly cache = new Map<string, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;
  private current: WordRef | null = null;
  /** `current` as a cache key, so the two cannot disagree. */
  private currentKey: string | null = null;
  /** Guards against a slow fetch finishing after a newer press started. */
  private token = 0;
  /**
   * Enough for a long sitting without growing without bound. A word is ~45 KB
   * compressed and a few hundred KB decoded, so this is the difference between
   * a cache and a leak.
   */
  private static readonly MAX_CACHED = 200;

  /** Fired with the word now sounding, or null when nothing is. */
  onChange: ((at: WordRef | null) => void) | null = null;

  /** Cache key. Private: callers speak in coordinates, not in strings. */
  private static key(surah: number, ayah: number, position: number): string {
    return `${surah}:${ayah}:${position}`;
  }

  /** `SSS_AAA_WWW.mp3` on Quran.com's CDN. `position` is 1-based. */
  private static url(surah: number, ayah: number, position: number): string {
    const pad = (n: number) => String(n).padStart(3, "0");
    return `https://audio.qurancdn.com/wbw/${pad(surah)}_${pad(ayah)}_${pad(position)}.mp3`;
  }

  get playing(): WordRef | null {
    return this.current;
  }

  /**
   * Say this word. Stops whatever was playing first — including this same
   * word, so a second press on a sounding word ends it.
   *
   * Returns the clip's length once it starts, so the caller can keep the
   * microphone from hearing it; 0 if nothing played.
   */
  async play(surah: number, ayah: number, position: number): Promise<number> {
    const key = WordAudio.key(surah, ayah, position);
    const wasPlaying = this.currentKey;
    this.stop();
    if (wasPlaying === key) return 0; // pressing the sounding word turns it off

    const ctx = audioOut();
    if (!ctx || !audioReady()) return 0;
    // `stop()` above already moved the token; this press owns that value, and
    // any older fetch still in flight will see it has been overtaken.
    const mine = this.token;

    let buffer = this.cache.get(key);
    if (!buffer) {
      try {
        const bytes = await (await fetch(WordAudio.url(surah, ayah, position))).arrayBuffer();
        buffer = await ctx.decodeAudioData(bytes);
      } catch (err) {
        // Offline, or the CDN is unreachable. Nothing to say, and nothing to
        // apologise for on screen — but the console should not stay quiet.
        console.warn(`[prompter] word audio unavailable (${key}):`, err);
        return 0;
      }
      // A press during the fetch already moved on; that press owns the sound.
      if (mine !== this.token) return 0;
      if (this.cache.size >= WordAudio.MAX_CACHED) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(key, buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      // Only if this source is still the current one: `stop()` clears it, and
      // stopping a source also fires `onended`.
      if (this.source === source) this.finish();
    };
    this.source = source;
    this.current = { surah, ayah, position };
    this.currentKey = key;
    this.onChange?.(this.current);
    source.start();
    return buffer.duration * 1000;
  }

  /** Silence whatever is playing. Safe when nothing is. */
  stop(): void {
    this.token++;
    const source = this.source;
    if (!source) {
      if (this.current !== null) this.finish();
      return;
    }
    this.source = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* already ended */
    }
    this.finish();
  }

  private finish(): void {
    this.source = null;
    if (this.current === null) return;
    this.current = null;
    this.currentKey = null;
    this.onChange?.(null);
  }
}
