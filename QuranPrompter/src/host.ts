import type { AyahRef, EngineEvent, HeardToken, RecitationEngine } from "@alketab/quran-engine";
import { closeAudio, resumeAudio } from "./audioOut.js";
import { Cue } from "./cue.js";
import { WordAudio, type WordRef } from "./wordAudio.js";
import { DecoderClient, MicCapture } from "@alketab/quran-engine/browser";
import type { FailureKind } from "./ui/screens.js";
import type { Prefs } from "./prefs.js";

export type Phase =
  | { kind: "listening" }
  | { kind: "reading" }
  | { kind: "failed"; failure: FailureKind };

/** Where 16 kHz audio chunks come from — the microphone, or a file in development. */
export interface AudioSource {
  readonly running: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AudioSourceCallbacks {
  onChunk: (samples: Float32Array) => void;
  onLive: () => void;
}

export type AudioSourceFactory = (cb: AudioSourceCallbacks) => AudioSource;

export const microphoneSource: AudioSourceFactory = (cb) => new MicCapture({ onChunk: cb.onChunk, onLive: cb.onLive });

/**
 * Something the reciter should be told in words, not just shown — the reason a
 * sitting changed course. The view decides whether and how to say it.
 */
export type Notice =
  /** A surah was recited to its end and the run went back to listening. */
  | { kind: "surahEnded"; surah: number }
  /** Reading rolled on into the next surah by itself. */
  | { kind: "continuing"; surah: number };

export interface HostView {
  phase(p: Phase): void;
  micLive(live: boolean): void;
  /**
   * How loud the room was over the chunk just heard: the RMS of each of its
   * `LEVEL_SLICES` equal slices, oldest first, after the app's own sounds were
   * muted out of it. Slices, not one number, so the orb can follow syllables
   * instead of stepping twice a second.
   */
  level?(slices: readonly number[]): void;
  /** See `Notice`. */
  notice?(n: Notice): void;
  /**
   * Still searching: the words the search's best guess spans, as global word
   * indices. A guess, never a verdict — for showing, not for deciding.
   */
  heard?(words: readonly number[]): void;
  /**
   * A surah is mounted (or re-mounted) and its marks cleared. `ayah` is where
   * the reciter was found in it — the found moment's «الآية ٣» names it.
   */
  mounted(surah: number, ayah: number): void;
  cursor(surah: number, ayah: number, wordIndex: number): void;
  verdicts(changes: EngineEvent & { type: "verdicts" }): void;
  /** Debug/telemetry line. */
  log(line: string): void;
}

/**
 * ملقّن القرآن's loop, ported from the iOS view model: search for whatever is
 * being recited, track it, and go back to searching when the surah ends or
 * nothing is heard for a while. Nothing here needs a tap once the screen is
 * open.
 */
export class PrompterHost {
  /** No word progress for this long ends the run and starts a search (8 s in the engine's frames). */
  private readonly engine: RecitationEngine;
  private readonly decoder: DecoderClient;
  private readonly view: HostView;
  private readonly prefs: Prefs;
  private readonly makeSource: AudioSourceFactory;
  private mic: AudioSource | null = null;
  private phase: Phase = { kind: "listening" };
  private closed = false;
  private suspended = false;
  /**
   * Has «ابدأ التلاوة» been pressed? Nothing may open the microphone before it
   * has — see `start()` and `handleVisibility`.
   */
  private started = false;
  private lastSurah: number | null = null;
  private activeHint: AyahRef | null = null;
  private backoffMs = 2000;
  private failingSince: number | null = null;
  private restartTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  /** When the last re-acquisition was attempted — see `requestWakeLock`. */
  private wakeLockRetryAt = 0;
  private readonly cue = new Cue("/sounds/tracking-mistake.mp3");
  readonly words = new WordAudio();
  /** Set by the host's owner: which word is sounding, for the underline. */
  onSpeaking: ((at: WordRef | null) => void) | null = null;
  /**
   * While a sound of ours is audible, the microphone is hearing the APP.
   * Feeding that back to the decoder would turn our own alert into phonemes
   * that match nothing — raising the very cost rate that produced the mistake,
   * right when it is already high. Echo cancellation is off on purpose (it
   * eats the soft onsets this model needs), so nothing else would catch it.
   *
   * **The window mutes SAMPLES, not chunks.** Audio arrives in 480 ms blocks,
   * and the first version dropped any block that touched the window — so a
   * 540 ms cue straddling two arrivals could throw away nearly a second of the
   * reciter's own words, and the tracker fell behind by exactly what was
   * binned. Now only the overlapping samples are zeroed: silence decodes as
   * blanks, the same as a real pause, and the speech on either side of the cue
   * inside the same block survives.
   */
  private deafFrom = 0;
  private deafUntil = 0;
  private static readonly FIRST_BACKOFF = 2000;
  private static readonly MAX_BACKOFF = 10000;
  private static readonly FAILURE_BUDGET = 60000;
  /** Floor between wake-lock attempts, so a refusing device cannot spin. */
  private static readonly WAKE_LOCK_RETRY = 30000;
  /** A lock held at least this long was working; losing it earns an instant retry. */
  private static readonly WAKE_LOCK_SETTLED = 5000;
  /** Slack after a clip ends: speaker-to-mic travel plus delivery jitter. */
  private static readonly DEAF_TAIL = 120;

  constructor(engine: RecitationEngine, decoder: DecoderClient, view: HostView, prefs: Prefs, makeSource: AudioSourceFactory = microphoneSource) {
    this.engine = engine;
    this.decoder = decoder;
    this.view = view;
    this.prefs = prefs;
    this.makeSource = makeSource;
    document.addEventListener("visibilitychange", () => this.handleVisibility());
    // The host opens the deaf window, so the host closes it. A word stopped
    // early — the reciter pressed another, or pressed the same one again —
    // used to leave the microphone deaf for the rest of a clip that was no
    // longer playing, throwing away that much of their own recitation.
    this.words.onChange = (at) => {
      // A word stopped early stops making sound NOW — but the sound it already
      // made is still inside blocks that have not arrived yet, so the window
      // is clamped to this moment rather than cleared. Clearing it outright
      // would let the clip's own tail through to the decoder.
      if (!at) this.deafUntil = Math.min(this.deafUntil, Date.now());
      this.onSpeaking?.(at);
    };
    // The setting can be switched while a surah is on screen, and the engine
    // has to hear about it then — not at the next search, which in this very
    // mode may never come.
    this.prefs.onChange(() => this.engine.setStayOnSurah(this.prefs.locateOnce));
    this.engine.setStayOnSurah(this.prefs.locateOnce);
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /**
   * Called once, from the press on «ابدأ التلاوة».
   *
   * **The wake lock is asked for FIRST, and deliberately not awaited before
   * asking.** WebKit gates `wakeLock.request()` behind user activation, and
   * activation does not survive an `await` on `getUserMedia` — that permission
   * prompt can sit open for seconds. Requesting inside the press is the whole
   * reason this screen has a button; opening the microphone first would put
   * the lock back outside the gesture and iOS would refuse it exactly as it
   * did before.
   */
  async start(from?: AyahRef): Promise<void> {
    if (this.closed || this.started) return;
    this.started = true;
    this.wakeLockRetryAt = 0;
    void this.requestWakeLock();
    // Browsers only grant an AudioContext inside a gesture, and this press is
    // the only one the prompter has. Not awaited: a sound must never delay the
    // microphone opening.
    this.cue.arm();
    await this.beginSearch();
    // `from` is the reciter saying where they are, so there is nothing to
    // search for — load it and listen from there. After `beginSearch`, which
    // opens the microphone and would otherwise clear this the moment it ran.
    if (!from || this.closed || !this.mic) return;
    // A position the corpus cannot show must not take the session down with
    // it: `started` is already true, so a throw here would leave the reciter
    // on a screen with no button and no page, recoverable only by reloading.
    // Listening is a fine outcome — it is what the other button does.
    if (!this.engine.corpus.hasAyah(from.surah, from.ayah)) {
      this.view.log(`ignoring an impossible saved position ${from.surah}:${from.ayah}`);
      return;
    }
    for (const ev of this.engine.track(from.surah, from.ayah)) this.handle(ev);
    // And PARK there. `located` mounts the surah but nothing scrolls it: the
    // page follows `cursor` events, and those only arrive once the reciter has
    // said something. Resuming has no audio yet, so Al-Kahf would open at ayah
    // 1 under a button promising ayah 45.
    this.view.cursor(from.surah, from.ayah, this.engine.corpus.wordIndex(from.surah, from.ayah, 0));
  }

  /**
   * Move to a place while the session is RUNNING — the reciter saying where
   * they are now, rather than being found.
   *
   * `start(from)` cannot do this: it refuses once started, because its job is
   * to open the microphone. Here the microphone is already open and only the
   * engine's place changes, exactly as `continueToNextSurah` changes it when a
   * surah is recited to its end.
   */
  goTo(at: AyahRef): boolean {
    if (this.closed || !this.started) return false;
    // Same guard as `start`: a place the corpus cannot show must not take a
    // live session down with it.
    if (!this.engine.corpus.hasAyah(at.surah, at.ayah)) {
      this.view.log(`ignoring an impossible position ${at.surah}:${at.ayah}`);
      return false;
    }
    this.view.log(`going to ${at.surah}:${at.ayah}`);
    this.rememberPlace(at);
    for (const ev of this.engine.track(at.surah, at.ayah)) this.handle(ev);
    // And PARK there — nothing has been recited from the new place yet, so no
    // cursor event is coming to scroll the page for us.
    this.view.cursor(at.surah, at.ayah, this.engine.corpus.wordIndex(at.surah, at.ayah, 0));
    return true;
  }

  /**
   * Listen for the reciter wherever they are now — the start screen's own
   * button, offered again at the end of a surah. The run in progress ends and
   * the search begins; the microphone is already open and stays open.
   */
  searchAgain(): void {
    if (this.closed || !this.started) return;
    this.view.log("searching again");
    this.endRunAndSearch();
  }

  close(): void {
    this.closed = true;
    closeAudio();
    this.cancelRestart();
    void this.stopMic();
    void this.releaseWakeLock();
  }

  /**
   * Stand the sitting down and go back to the start screen — what changing
   * mode does.
   *
   * The modes disagree about silence, about a finished surah and about another
   * surah entirely, so a run half-tracked under one of them describes nothing
   * under the next. Everything goes: the microphone closes, the wake lock is
   * released and `started` is cleared, which is what puts «ابدأ التلاوة» back
   * and lets the next press buy a wake lock again — iOS only grants one inside
   * a gesture.
   */
  restart(): void {
    if (this.closed) return;
    this.cancelRestart();
    this.started = false;
    void this.stopMic();
    void this.releaseWakeLock();
    // `setStayOnSurah` is not repeated here: the subscription in the
    // constructor already fired for this change, and one place tying the
    // engine to the mode is what keeps them from drifting apart.
    this.engine.startSearch();
    this.decoder.reset();
    // A fresh sitting gets a fresh failure budget.
    this.failingSince = null;
    this.backoffMs = PrompterHost.FIRST_BACKOFF;
    this.setPhase({ kind: "listening" });
  }

  /**
   * Say a word aloud — the reciter held it down.
   *
   * The microphone goes deaf for as long as the clip lasts, for the reason the
   * mistake cue does: echo cancellation is off on purpose, so the app would
   * otherwise hear its own playback and hand the decoder a second voice
   * reciting a word out of order.
   */
  speakWord(surah: number, ayah: number, position: number): void {
    void this.words.play(surah, ayah, position).then((ms) => {
      if (ms > 0) this.goDeafFor(ms);
    });
  }

  /** «إعادة المحاولة» — the failure screen's one button. */
  resume(): void {
    if (this.closed) return;
    this.failingSince = null;
    this.backoffMs = PrompterHost.FIRST_BACKOFF;
    this.setPhase({ kind: "listening" });
    this.scheduleSearch(0);
  }

  /** The decoder's tokens for one chunk. */
  onTokens(tokens: HeardToken[], framesDecoded: number): void {
    if (this.closed || this.suspended || this.phase.kind === "failed") return;
    const events = this.engine.feed(tokens, framesDecoded);
    for (const e of events) this.handle(e);
  }

  onDecoderError(message: string): void {
    this.view.log(`decoder: ${message}`);
    this.fail("modelUnavailable");
  }

  // MARK: - the loop

  private handle(e: EngineEvent): void {
    switch (e.type) {
      case "located":
        this.view.log(`located ${e.surah}:${e.ayah} w${e.word} (replayed ${e.replayed})`);
        void this.requestWakeLock();
        this.lastSurah = e.surah;
        this.view.mounted(e.surah, e.ayah);
        this.setPhase({ kind: "reading" });
        break;
      case "relocated":
        this.view.log(`relocated ${e.from.surah}:${e.from.ayah} → ${e.to.surah}:${e.to.ayah}`);
        this.lastSurah = e.to.surah;
        this.view.mounted(e.to.surah, e.to.ayah);
        break;
      case "cursor":
        this.view.cursor(e.surah, e.ayah, e.wordIndex);
        // Reading keeps the place, so the start screen can offer it back
        // tomorrow. Only reading: the other modes begin wherever the reciter
        // begins, and a place they never asked to keep would be a stale surah
        // on a button.
        this.rememberPlace({ surah: e.surah, ayah: e.ayah });
        break;
      case "verdicts":
        this.view.verdicts(e);
        // Reading mode only, and only if the reciter asked for it: prayer is
        // the one place this app is used with the phone on the floor.
        if (this.prefs.mistakeSound && this.prefs.locateOnce && e.changes.some((c) => c.state === "wrong")) {
          // The cue throttles itself to one every 1.5 s — a reciter who has
          // drifted onto the wrong ayah would otherwise set it off per word.
          if (this.cue.play()) this.goDeafFor(this.cue.durationMs);
        }
        break;
      case "lost":
        this.view.log("lost");
        break;
      case "hearing":
        this.view.heard?.(e.words);
        break;
      case "locateFailed":
        this.locateFailed();
        break;
      case "idle":
        // Reading, not praying: the reciter asked to be left on this surah,
        // so silence is a pause to think and not the end of a sitting. Not
        // logged either — the engine re-raises `idle` every 8 s of quiet, and
        // a mode built to sit quiet would bury every other line in the log.
        if (this.prefs.locateOnce) break;
        // `silent` is the reciter stopping, `lost` is the reciter talking
        // instead of reciting. Both end the run the same way: the mic stays
        // open and the search picks them up wherever they resume.
        this.view.log(`idle (${e.reason}) — searching again`);
        this.endRunAndSearch();
        break;
      case "completed":
        this.view.log(`completed surah ${e.surah}`);
        // The place to come back to is where the reciter would GO ON from, and
        // a finished surah is not it: left at its last ayah, the button
        // tomorrow offers to read the one ayah they had just finished.
        if (e.surah < 114) this.rememberPlace({ surah: e.surah + 1, ayah: 1 });
        if (this.prefs.locateOnce && this.continueToNextSurah(e.surah)) break;
        this.view.notice?.({ kind: "surahEnded", surah: e.surah });
        this.endRunAndSearch();
        break;
    }
  }

  /**
   * Roll straight into the next surah, the way turning a page does — the
   * reading mode's answer to a surah ending. Returns false at An-Nas, which
   * has no next: the run then ends as it always did.
   *
   * `track()` loads the position outright instead of searching for it. That is
   * the whole point of the mode — there is no second search — and it is also
   * the only honest option: the reciter has said nothing yet from the new
   * surah for a search to find.
   */
  private continueToNextSurah(finished: number): boolean {
    const next = finished + 1;
    if (next > 114) return false;
    this.view.log(`continuing to surah ${next}`);
    this.view.notice?.({ kind: "continuing", surah: next });
    for (const ev of this.engine.track(next, 1)) this.handle(ev);
    return true;
  }

  /**
   * Keep the place, so the start screen can offer it back tomorrow. Reading
   * only: the other modes begin wherever the reciter begins, and a place they
   * never asked to keep would be a stale surah on a button.
   */
  private rememberPlace(at: AyahRef): void {
    if (this.prefs.remembersPlace) this.prefs.lastRead = at;
  }

  /** Which ayah to lean the next search toward — الفاتحة, or nothing. */
  private get searchHint(): AyahRef | null {
    if (!this.prefs.expectFatihah) return null;
    return this.lastSurah === 1 ? null : { surah: 1, ayah: 1 };
  }

  private async beginSearch(): Promise<void> {
    if (this.closed || this.suspended) return;
    this.setPhase({ kind: "listening" });
    this.activeHint = this.searchHint;
    this.engine.setHint(this.activeHint);
    this.engine.startSearch();
    this.decoder.reset();
    await this.startMic();
    // `startMic` returns early when the mic is already open, so a lock the
    // device refused earlier would never be asked for again. Ask on every
    // fresh search too — the retry floor keeps that to twice a minute.
    await this.requestWakeLock();
  }

  private endRunAndSearch(): void {
    this.engine.startSearch();
    this.decoder.reset();
    this.engine.setHint((this.activeHint = this.searchHint));
    this.setPhase({ kind: "listening" });
  }

  /** 15 s without a lock: a signal, not an ending — the mic stays open. */
  private locateFailed(): void {
    this.failingSince = null;
    this.backoffMs = PrompterHost.FIRST_BACKOFF;
    this.lastSurah = null;
    const hint = this.searchHint;
    if (hint?.surah !== this.activeHint?.surah || hint?.ayah !== this.activeHint?.ayah) {
      this.activeHint = hint;
      this.engine.setHint(hint);
    }
  }

  private scheduleSearch(delayMs: number): void {
    this.cancelRestart();
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      if (this.closed || this.suspended || !this.started || this.phase.kind === "failed") return;
      void this.beginSearch();
    }, delayMs);
  }

  private cancelRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  // MARK: - mic

  private async startMic(): Promise<void> {
    // Guard on the instance, not on `running`: that stays false for the whole
    // of `start()` — including the permission prompt, which can sit open for
    // seconds — so a second call arriving meanwhile would open a second
    // microphone and orphan the first. `this.mic` is assigned synchronously
    // below, so it closes the window.
    if (this.mic) return;
    const mic = this.makeSource({
      onChunk: (samples) => {
        if (this.closed || this.suspended) return;
        this.muteOwnAudio(samples);
        // After the muting, so the app's own cue does not make the orb jump as
        // if the reciter had spoken. One pass over 7,680 samples per 480 ms.
        if (this.view.level) this.view.level(sliceLevels(samples));
        this.decoder.pushAudio(samples);
      },
      onLive: () => {
        this.view.micLive(true);
        this.backoffMs = PrompterHost.FIRST_BACKOFF;
        this.failingSince = null;
      },
    });
    this.mic = mic;
    try {
      await mic.start();
      await this.requestWakeLock();
    } catch (err) {
      this.mic = null;
      this.micFailed(err);
    }
  }

  private async stopMic(): Promise<void> {
    this.words.stop();
    const mic = this.mic;
    this.mic = null;
    this.view.micLive(false);
    if (mic) await mic.stop();
  }

  private micFailed(err: unknown): void {
    const name = err instanceof DOMException ? err.name : "";
    this.view.log(`mic: ${name || String(err)}`);
    if (name === "NotAllowedError" || name === "SecurityError") {
      this.fail("micDenied");
      return;
    }
    // Transient: retry with backoff for a minute before giving up.
    const now = Date.now();
    this.failingSince ??= now;
    if (now - this.failingSince >= PrompterHost.FAILURE_BUDGET) {
      this.fail("micUnavailable");
      return;
    }
    this.scheduleSearch(this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, PrompterHost.MAX_BACKOFF);
  }

  private fail(failure: FailureKind): void {
    this.cancelRestart();
    this.setPhase({ kind: "failed", failure });
    void this.stopMic();
    // The screen must be allowed to sleep again: nothing is listening any more,
    // and a failure screen holding the wake lock kept the phone awake until the
    // app was backgrounded. Every other exit path already releases it.
    void this.releaseWakeLock();
  }

  private handleVisibility(): void {
    if (document.visibilityState === "hidden") {
      if (this.suspended || this.closed) return;
      this.suspended = true;
      this.cancelRestart();
      void this.stopMic();
      void this.releaseWakeLock();
    } else {
      if (!this.suspended) return;
      this.suspended = false;
      if (this.phase.kind === "failed") return;
      // NOT before the press. Coming back to a tab that was never started used
      // to resume it: the microphone opened with no prompt (permission was
      // already granted from an earlier session) while the button was still on
      // screen — and pressing it then did nothing visible, because `startMic`
      // saw a microphone already open and never reported `onLive` again. The
      // button vanished onto a blank screen. Reported 2026-09-05, after being
      // away from Safari a long time.
      if (!this.started) return;
      // Coming back to a visible tab: its audio context was suspended while it
      // was away, and a suspended one drops cues.
      resumeAudio();
      this.wakeLockRetryAt = 0; // a fresh look at the screen is not a hot loop
      this.scheduleSearch(0);
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.view.phase(p);
  }

  /** Should the screen be held awake right now? Exactly: is the mic open. */
  private get wantWakeLock(): boolean {
    return !this.closed && !this.suspended && this.mic !== null && document.visibilityState === "visible";
  }

  /**
   * Hold the screen awake while the microphone is open.
   *
   * **iOS RELEASES THIS ON ITS OWN, and the page must ask again** (Tarek,
   * 2026-09-05, reciting in prayer with the mic live). The platform may drop a
   * screen lock at any time — low battery, Low Power Mode, a system
   * interruption — and it does so while the page is still perfectly visible,
   * so no `visibilitychange` follows to rebuild it. This used to guard on
   * `!this.wakeLock`, which stayed truthy pointing at the DEAD sentinel: one
   * such release and the screen slept for the rest of the session.
   *
   * So: re-check `released`, and listen for the event that says it happened.
   * `wakeLockRetryAt` is only there to stop a device that refuses the lock
   * outright from turning grant/release into a hot loop.
   */
  /** Open (or extend) the deaf window for a sound that just started. */
  private goDeafFor(ms: number): void {
    const now = Date.now();
    // Overlapping sounds share one window; a fresh one starts its own.
    if (now > this.deafUntil) this.deafFrom = now;
    this.deafUntil = Math.max(this.deafUntil, now + ms + PrompterHost.DEAF_TAIL);
  }

  /**
   * Zero the part of this block that our own audio was playing over. The block
   * ends roughly now and is 480 ms long, so wall-clock and sample offsets line
   * up to within the worklet's delivery jitter — and the window carries a tail
   * for exactly that slack.
   */
  private muteOwnAudio(samples: Float32Array): void {
    if (this.deafUntil === 0) return;
    const end = Date.now();
    const start = end - samples.length / 16; // 16 samples per millisecond
    if (start >= this.deafUntil) {
      // The window is wholly in the past; nothing later can overlap it.
      this.deafFrom = 0;
      this.deafUntil = 0;
      return;
    }
    if (end <= this.deafFrom) return;
    const from = Math.max(0, Math.floor((this.deafFrom - start) * 16));
    const to = Math.min(samples.length, Math.ceil((this.deafUntil - start) * 16));
    if (from < to) samples.fill(0, from, to);
  }

  private async requestWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    if (this.wakeLock && !this.wakeLock.released) return;
    const now = Date.now();
    if (now - this.wakeLockRetryAt < PrompterHost.WAKE_LOCK_RETRY) return;
    this.wakeLockRetryAt = now;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      const heldFrom = Date.now();
      this.wakeLock = sentinel;
      sentinel.addEventListener("release", () => {
        this.view.log("wake lock released by the system");
        if (this.wakeLock === sentinel) this.wakeLock = null;
        if (!this.wantWakeLock) return;
        // A lock that survived a while and then went is the system reclaiming
        // it: ask again AT ONCE, or the screen stays dark for the length of
        // the retry floor — mid-prayer, which is the whole point of this. Only
        // a lock dropped as fast as it was granted is a device refusing, and
        // that is the one case the floor is for.
        if (Date.now() - heldFrom >= PrompterHost.WAKE_LOCK_SETTLED) this.wakeLockRetryAt = 0;
        void this.requestWakeLock();
      });
    } catch {
      // Refused — Low Power Mode, low battery, or no support. Nothing a page
      // can do about it, and the next attempt is a retry interval away.
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.wakeLock;
    // Cleared FIRST: releasing fires the `release` listener above, and it must
    // not read this as the system dropping the lock and ask for it back.
    this.wakeLock = null;
    this.wakeLockRetryAt = 0;
    try {
      await sentinel?.release();
    } catch {
      /* ignore */
    }
  }
}

/** 40 ms each at the decoder's 480 ms chunk — about a syllable. */
const LEVEL_SLICES = 12;

/** RMS of each of `LEVEL_SLICES` equal slices of a chunk. One pass. */
function sliceLevels(samples: Float32Array): number[] {
  const out: number[] = [];
  const len = Math.floor(samples.length / LEVEL_SLICES);
  if (len === 0) return out;
  for (let s = 0; s < LEVEL_SLICES; s++) {
    let sum = 0;
    for (let i = s * len; i < (s + 1) * len; i++) sum += samples[i] * samples[i];
    out.push(Math.sqrt(sum / len));
  }
  return out;
}
