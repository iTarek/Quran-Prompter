import { armAudio, audioOut, audioReady } from "./audioOut.js";

/**
 * The mistake cue — one short sound, decoded once and played from memory.
 *
 * **It must never cost the decoder a frame.** A chunk of audio arrives every
 * 480 ms and has that long to be turned into phonemes; an `<audio>` element
 * would fetch, decode and re-open an output route on the main thread at
 * exactly the moment a mistake is being drawn. So the file is fetched and
 * decoded ONCE, ahead of time, and playing it is one `AudioBufferSourceNode` —
 * no allocation on the audio thread, no main-thread work, nothing to block.
 * The iOS app reaches the same conclusion from the other side: it plays off
 * the main thread because doing it on-thread froze the tracking bar.
 */
export class Cue {
  private buffer: AudioBuffer | null = null;
  private loading: Promise<void> | null = null;
  private readonly url: string;
  private lastPlayed = 0;
  /**
   * Minimum gap between cues, matching the iOS app's 1.5 s.
   *
   * The alert fires per mistaken WORD, so a reciter who has drifted onto the
   * wrong ayah would otherwise set it off at speech rate — a buzz storm
   * exactly when they are already struggling.
   */
  private static readonly INTERVAL_MS = 1500;

  constructor(url: string) {
    this.url = url;
  }

  /**
   * Call from inside the press. Takes the shared context the browser will only
   * grant to a gesture, and starts fetching; nothing here is awaited by the
   * caller, because a sound must not delay opening the microphone.
   */
  arm(): void {
    if (this.loading) return;
    armAudio();
    const ctx = audioOut();
    if (!ctx) return;
    this.loading = (async () => {
      try {
        const bytes = await (await fetch(this.url)).arrayBuffer();
        this.buffer = await ctx.decodeAudioData(bytes);
      } catch (err) {
        // **Say so.** A cue that never sounds because its file 404'd is
        // indistinguishable from one the reciter left switched off, and a
        // silent failure here cost an evening of looking in the wrong place.
        this.buffer = null;
        console.warn(`[prompter] mistake cue unavailable (${this.url}):`, err);
      }
    })();
  }

  /**
   * Play, unless one played less than `INTERVAL_MS` ago. Returns whether it
   * did, so the caller can keep the reciter's own voice out of the decoder
   * for as long as this is audible.
   */
  play(): boolean {
    const ctx = audioOut();
    const buffer = this.buffer;
    if (!ctx || !buffer || !audioReady()) return false;
    const now = Date.now();
    if (now - this.lastPlayed < Cue.INTERVAL_MS) return false;
    this.lastPlayed = now;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    return true;
  }

  /** How long the sound stays audible, for callers that must wait it out. */
  get durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }
}
