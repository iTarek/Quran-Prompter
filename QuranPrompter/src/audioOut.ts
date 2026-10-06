/**
 * The app's one output AudioContext, and the rule that it is created inside a
 * user gesture.
 *
 * **One, not two.** The mistake cue and the word player both need to make
 * sound; giving each its own context wastes a hardware audio route and, on
 * iOS, invites two of them to fight over the session while the microphone is
 * open. They share this.
 *
 * Browsers refuse audio until a gesture, and the prompter has exactly one —
 * the press on «ابدأ التلاوة», which is also where the wake lock is taken.
 */
let ctx: AudioContext | null = null;

/** Call from inside the press. Safe to call again; the second call is a no-op. */
export function armAudio(): void {
  if (ctx) return;
  try {
    ctx = new AudioContext();
  } catch (err) {
    console.warn("[prompter] no audio context — the cue and word audio are off:", err);
  }
}

/** The context, or null if the browser never gave us one. */
export function audioOut(): AudioContext | null {
  return ctx;
}

/**
 * Whether sound can be made RIGHT NOW.
 *
 * A suspended context — a backgrounded tab, a window that lost focus — has a
 * frozen clock, so anything scheduled on it lands on the same timestamp and
 * they all fire together the moment it resumes. Callers ask this and give up
 * rather than queueing; resuming is asynchronous, and a sound that arrives
 * after the thing it describes is noise.
 */
export function audioReady(): boolean {
  if (!ctx) return false;
  if (ctx.state === "running") return true;
  void ctx.resume();
  return false;
}

/** Bring it back after the tab was hidden, so the next sound is not dropped. */
export function resumeAudio(): void {
  if (ctx && ctx.state !== "running") void ctx.resume();
}

export function closeAudio(): void {
  void ctx?.close();
  ctx = null;
}
