import "./styles.css";
import { QuranCorpus, QuranIndex, RecitationEngine, type AyahRef, type EngineEvent, type QuranData } from "@alketab/quran-engine";
import { DecoderClient } from "@alketab/quran-engine/browser";
import { devAudioFromLocation, loadDevAudio, playDevAudio } from "./devAudio.js";
import { PrompterHost, type AudioSourceFactory, type Notice, type Phase } from "./host.js";
import { lang, onLangChange, surahName, uiDir } from "./lang.js";
import { Meanings, type MeaningEntry } from "./meaning.js";
import { enableOffline } from "./offline.js";
import { Prefs, type Mode } from "./prefs.js";
import { t } from "./strings.js";
import { installTheme } from "./theme.js";
import { loadTranslit } from "./translit.js";
import { lockPageZoom } from "./zoom.js";
import { aboutPage, type Installer } from "./ui/about.js";
import { Home } from "./ui/home.js";
import { ListenScreen } from "./ui/listen.js";
import { MeaningSheet } from "./ui/meaning.js";
import { ModeBar } from "./ui/modeBar.js";
import { Animator, type Scene } from "./ui/orb.js";
import { PromptPage } from "./ui/page.js";
import { ReaderScreen } from "./ui/reader.js";
import { FailureScreen, LoadingOverlay } from "./ui/screens.js";
import { settingsSheet, surahSheet, type Sheet } from "./ui/sheets.js";
import { Toast } from "./ui/toast.js";

// Injected by vite.config.ts: each file's own content hash. Both are part of
// the URL because both files are cached by URL — the model by the engine, the
// data by the service worker — and a stable URL would pin every returning
// visitor to the first copy they downloaded. See the note there.
declare const __MODEL_VERSION__: string;
declare const __DATA_VERSION__: string;
// The translations of the meanings the site ships, with each file's hash —
// vite.config.ts, from the engine's manifest.
declare const __MEANINGS__: MeaningEntry[];
const MODEL_URL = `/models/quran_phoneme_zipformer.onnx?v=${__MODEL_VERSION__}`;
const DATA_URL = `/data/quran.json?v=${__DATA_VERSION__}`;

/**
 * How long the found moment («وجدتُ موضعك», or «إلى موضعك» for a place the
 * reciter chose) holds over the page before letting go of it. The
 * page is already following the reciter underneath the whole time — this is
 * only how long the name stays readable.
 */
const FOUND_HOLD_MS = 800;
/**
 * The listening layer's fade-in (`.layer` in styles.css). When the found moment
 * has to bring the layer back up over the page, the hold is this much longer,
 * so the name is held at full strength as long as when it was found.
 */
const LAYER_FADE_MS = 500;

async function main(): Promise<void> {
  // The crawlable copy in index.html has done its job once the app runs.
  document.getElementById("seo")?.remove();
  lockPageZoom();
  const app = document.getElementById("app")!;
  const prefs = new Prefs();
  const applyFont = () => document.documentElement.style.setProperty("--font-multi", String(prefs.fontMulti));
  applyFont();
  const animator = new Animator();
  installTheme(prefs, () => animator.redraw());

  // The overlay goes up before anything else can: the quran.json fetch and
  // the model below both take a moment on a first visit.
  const loading = new LoadingOverlay();
  app.appendChild(loading.el);

  // ---- the decoder, FIRST ------------------------------------------------
  // Loading the model is the longest step of every start, and it needs nothing
  // from the data below — so it begins before the data is even fetched, and
  // the two overlap instead of queueing. It used to start only after the data
  // was parsed and indexed: on a 4×-throttled CPU the start screen came up at
  // 2.4 s, with the model not asked for until 1.2 s. The decoder exists before
  // the host does, so its callbacks reach the host through `toHost`.
  const toHost: { host: PrompterHost | null } = { host: null };
  const worker = new Worker(new URL("./decoder.worker.ts", import.meta.url), { type: "module" });
  const decoder = new DecoderClient(worker, {
    modelUrl: MODEL_URL,
    onTokens: (tokens, frames, ms) => {
      if (ms > 400) console.warn(`[prompter] slow chunk: ${ms.toFixed(0)} ms`);
      toHost.host?.onTokens(tokens, frames);
    },
    onProgress: (l, total) => loading.progress(l, total),
    // Before the host exists, a failure still rejects `decoderReady`, which
    // is what puts up the failure screen below.
    onError: (m) => toHost.host?.onDecoderError(m),
  });
  const decoderReady = decoder.init();
  // Awaited once the screens are built; until then a failure must not be
  // reported as an unhandled rejection.
  decoderReady.catch(() => undefined);

  // ---- data --------------------------------------------------------------
  const [data] = await Promise.all([
    fetch(DATA_URL).then((r) => {
      if (!r.ok) throw new Error(`quran.json HTTP ${r.status}`);
      return r.json() as Promise<QuranData>;
    }),
    document.fonts.load("44px 'KFGQPC Hafs Smart'").catch(() => undefined),
    document.fonts.load("500 16px 'Readex Pro'").catch(() => undefined),
  ]);
  const corpus = new QuranCorpus(data);
  const index = new QuranIndex(corpus);
  const engine = new RecitationEngine(corpus, index);

  // ---- screens -----------------------------------------------------------
  // Back to front: the start screen and its header and tab bar at the bottom,
  // then the reader, the listening orb over it, the failure screen, and the
  // loading overlay over everything.
  const home = new Home(animator);
  const modeBar = new ModeBar(prefs);
  const page = new PromptPage(corpus);
  const reader = new ReaderScreen(page, animator);
  const listen = new ListenScreen(animator);
  const failure = new FailureScreen(
    () => host.resume(),
    () => backToStart(),
  );
  const toast = new Toast();
  // The meaning of the ayah being recited, at the foot of the reading screen.
  // It hears what the page hears — phase, mount, cursor — so it is silent
  // until the engine has located the reciter.
  const meanings = new Meanings(
    prefs,
    __MEANINGS__,
    Array.from({ length: 114 }, (_, i) => corpus.surah(i + 1).ayahCount),
  );
  const meaningSheet = new MeaningSheet();
  reader.el.appendChild(meaningSheet.el);
  meaningSheet.onHeight = (px) => page.setReserve(px);
  meanings.onChange(() => meaningSheet.setFile(meanings.file, meanings.entry));
  app.prepend(home.el, home.header, modeBar.el, reader.el, listen.el, failure.el);

  // ---- the sitting -------------------------------------------------------
  /**
   * Has «ابدأ التلاوة» been pressed in this sitting? Before it, the start
   * screen is the whole app; after it, the phase decides between the orb and
   * the page. Cleared by `backToStart`.
   */
  let armed = false;
  let phase: Phase = { kind: "listening" };
  let micLive = false;
  /**
   * Praying only: which rak‘ah this is. A rak‘ah is الفاتحة and then a surah,
   * so the count is NOT "every return to listening" — الفاتحة ending sends the
   * engine back to listening for the surah that follows, in the same rak‘ah.
   * See `countRakah`.
   */
  let rakah = 1;
  /** The surah on the page, so the end of a reading knows what just ended. */
  let readingSurah: number | null = null;
  /** الفاتحة was recited to its END since it was last found — see `countRakah`. */
  let fatihaCompleted = false;
  /** This rak‘ah's number has already moved on (its surah ended into silence). */
  let rakahCounted = false;
  /**
   * The next time the page comes up, it is because the reciter TOLD us where
   * they are (resume, the index) — not because they were found. The found
   * moment still plays, as the way from the orb to the page, but says «إلى
   * موضعك» rather than «وجدتُ موضعك»: nobody searched.
   */
  let chosenNext = false;
  let foundTimer: number | null = null;
  /** The surah and ayah the engine located at, for the found moment. */
  let locatedAt: AyahRef | null = null;
  let currentAyah: AyahRef | null = null;
  /** A notice that should be said when the orb next comes up. */
  let pendingToast: string | null = null;

  const render = () => {
    const failed = phase.kind === "failed";
    const reading = armed && phase.kind === "reading";
    const listening = armed && phase.kind === "listening";
    failure.show(phase.kind === "failed" ? phase.failure : null);
    reader.show(reading);
    // The listening layer stays up through the found moment, over the page.
    if (listening) listen.show(true);
    else if (!(reading && foundTimer !== null)) listen.show(false);
    let scene: Scene = "landing";
    if (failed) scene = "still";
    else if (reading) scene = foundTimer !== null ? "found" : "reading";
    else if (listening) scene = "listening";
    animator.setScene(scene);
    document.body.dataset.scene = scene;
  };

  /**
   * The found moment: the surah's name rising in the orb, the ayah under it,
   * held for `FOUND_HOLD_MS` over a page already live underneath, then the
   * page. Played when the engine finds the reciter, and — so choosing a place
   * feels the same as being found — when the reciter picks one: resume or a
   * surah from the start screen, or the next surah / the index from the end
   * of one. From the page, the listening layer is brought back up for it.
   */
  const announce = (at: AyahRef, chosen: boolean) => {
    const rising = !listen.visible;
    if (rising) listen.show(true);
    listen.found(corpus.surah(at.surah).name, at.ayah, chosen);
    if (foundTimer !== null) clearTimeout(foundTimer);
    foundTimer = window.setTimeout(
      () => {
        foundTimer = null;
        render();
      },
      FOUND_HOLD_MS + (rising ? LAYER_FADE_MS : 0),
    );
    animator.kick(0.6);
    render();
  };

  /**
   * The rak‘ah count, from two signals, each covering what the other cannot:
   *
   * - A SURAH OTHER THAN الفاتحة gives way to listening: that is the silence
   *   of rukuʿ, the rak‘ah is over. Counted here, so the orb that comes up
   *   already says «الركعة ٢» under «انتهت الركعة — أنتظر الفاتحة».
   * - الفاتحة is found again after being recited to its end, with no surah
   *   between: a rak‘ah of الفاتحة alone (the third and fourth of الظهر).
   *
   * Losing الفاتحة half-way and finding it again is neither: it was never
   * completed, so it is still the same rak‘ah.
   */
  const countRakah = {
    reset() {
      rakah = 1;
      readingSurah = null;
      fatihaCompleted = false;
      rakahCounted = false;
      listen.setRakah(prefs.mode === "praying" ? rakah : null);
    },
    found(surah: number) {
      if (prefs.mode !== "praying" || surah !== 1) return;
      if (fatihaCompleted && !rakahCounted) rakah++;
      fatihaCompleted = false;
      rakahCounted = false;
      listen.setRakah(rakah);
    },
    completed(surah: number) {
      if (surah === 1) fatihaCompleted = true;
    },
    /** The page gave way to listening. True when that ended a rak‘ah. */
    releasedPage(): boolean {
      if (prefs.mode !== "praying" || readingSurah === null || readingSurah === 1) return false;
      rakah++;
      rakahCounted = true;
      listen.setRakah(rakah);
      return true;
    },
  };

  /** Press on any way in: the orb, resume, a surah from the index, the About page. */
  const arm = () => {
    if (!armed) {
      armed = true;
      countRakah.reset();
      listen.setMicLive(micLive);
    }
    render();
  };
  const start = (from?: AyahRef) => {
    chosenNext = from !== undefined;
    arm();
    void host.start(from);
  };

  /**
   * Stand the whole sitting down: the host closes the mic and clears
   * `started`, and the start screen comes back. What the × does, and what
   * changing mode does — one function, so the two can never drift apart.
   */
  const backToStart = () => {
    armed = false;
    chosenNext = false;
    locatedAt = null;
    if (foundTimer !== null) clearTimeout(foundTimer);
    foundTimer = null;
    toast.hide();
    host.restart();
    // The place moves as the reciter reads, and `lastRead` deliberately does
    // not announce it — the listeners are settings observers, and it would
    // fire on every ayah. So the resume button is re-read HERE, on the way
    // back to the screen that shows it; without this it kept whatever it was
    // built with at page load, offering last night's surah.
    syncOffers();
    render();
  };

  const onModeChanged = () => {
    const mode: Mode = prefs.mode;
    home.setMode(mode);
    modeBar.retitle();
    listen.setMode(mode);
    animator.setMode(mode);
    animator.kick();
    backToStart();
  };
  modeBar.onChange = onModeChanged;

  // ---- view --------------------------------------------------------------
  const setPlace = () => {
    if (!currentAyah) return;
    const s = corpus.surah(currentAyah.surah);
    reader.setPlace(surahName(s), currentAyah.ayah, s.ayahCount);
  };
  const view = {
    phase(p: Phase) {
      const wasReading = phase.kind === "reading";
      phase = p;
      if (p.kind === "reading" && !wasReading && armed) {
        // Found — or chosen, from the start screen. Hold the name up over the
        // page for a moment; the page is live underneath already.
        if (listen.visible && locatedAt) announce(locatedAt, chosenNext);
        chosenNext = false;
      }
      if (p.kind === "listening" && wasReading && armed) {
        if (countRakah.releasedPage()) pendingToast = t().endedPray;
        if (pendingToast) toast.show(pendingToast);
        pendingToast = null;
      }
      if (p.kind !== "reading") currentAyah = null;
      meaningSheet.phase(p);
      render();
    },
    micLive(live: boolean) {
      micLive = live;
      if (armed) listen.setMicLive(live);
    },
    level(slices: readonly number[]) {
      animator.hear(slices);
    },
    // The search's guess, floated up behind the orb in the mushaf's glyphs.
    heard(words: readonly number[]) {
      listen.float(words.map((w) => ({ key: w, text: corpus.displayWord(w) })));
    },
    notice(n: Notice) {
      if (n.kind === "surahEnded") {
        countRakah.completed(n.surah);
        // In prayer the rak‘ah count says it, in its own words.
        if (prefs.mode !== "praying") pendingToast = t().ended;
      }
      if (n.kind === "continuing") toast.show(t().continuing(surahName(corpus.surah(n.surah))), 2400);
    },
    mounted(surah: number, ayah: number) {
      locatedAt = { surah, ayah };
      readingSurah = surah;
      countRakah.found(surah);
      page.mount(surah);
      page.clearMarks();
      currentAyah = { surah, ayah };
      setPlace();
      meaningSheet.mounted(surah, ayah);
      reader.setProgress(0);
    },
    cursor(surah: number, ayah: number, wordIndex: number) {
      currentAyah = { surah, ayah };
      setPlace();
      meaningSheet.cursor(surah, ayah);
      const info = corpus.surah(surah);
      reader.setProgress((wordIndex - info.firstWord + 1) / Math.max(1, info.endWord - info.firstWord));
      page.setCurrent(wordIndex);
    },
    verdicts(e: EngineEvent & { type: "verdicts" }) {
      page.applyVerdicts(e.changes);
    },
    log(line: string) {
      console.log(`[prompter] ${line}`);
    },
  };

  // ---- host ----------------------------------------------------------------
  const dev = devAudioFromLocation();
  let source: AudioSourceFactory | undefined;
  if (dev) {
    const samples = await loadDevAudio(dev.url);
    view.log(`dev audio: ${dev.url} (${(samples.length / 16000).toFixed(1)} s at ${dev.speed}×)`);
    source = (cb) => {
      let stop: (() => void) | null = null;
      return {
        get running() {
          return stop !== null;
        },
        async start() {
          stop = playDevAudio(samples, dev.speed, cb.onChunk, cb.onLive);
        },
        async stop() {
          stop?.();
          stop = null;
        },
      };
    };
  }
  const host = new PrompterHost(engine, decoder, view, prefs, source);
  toHost.host = host;
  // Design/debug hook: `prompter.show(2)` renders a surah with no audio, so
  // typography can be checked without reciting.
  (window as unknown as { prompter: unknown }).prompter = {
    host,
    engine,
    corpus,
    page,
    animator,
    meanings,
    show: (surah: number) => {
      armed = true;
      view.mounted(surah, 1);
      view.phase({ kind: "reading" });
    },
  };

  // ---- sheets ------------------------------------------------------------
  // Chrome/Edge fire `beforeinstallprompt` and expect the event to be kept and
  // replayed from a user gesture; Safari never fires it, so the About page
  // also carries written steps.
  let installEvent: (Event & { prompt(): Promise<void> }) | null = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as Event & { prompt(): Promise<void> };
  });
  window.addEventListener("appinstalled", () => (installEvent = null));
  const installer: Installer = {
    available: () => installEvent !== null,
    prompt: () => {
      void installEvent?.prompt();
      installEvent = null;
    },
  };

  let settings: Sheet | null = null;
  const openSettings = () => {
    settings?.close();
    settings = settingsSheet(corpus, prefs, meanings);
    const mine = settings;
    mine.addEventListener("close", () => {
      if (settings === mine) settings = null;
    });
    document.body.appendChild(mine);
    mine.showModal();
  };
  home.onSettings = openSettings;
  reader.onSettings = openSettings;
  home.onHelp = () => {
    const about = aboutPage(corpus, prefs, meanings, {
      installer,
      onMode: (m) => {
        if (prefs.mode === m) return;
        prefs.mode = m;
        onModeChanged();
      },
      onStart: () => start(),
    });
    document.body.appendChild(about);
    about.showModal();
    // The About page covers the whole screen: the start screen's orb under it
    // would go on drawing sixty times a second for nobody. It stops while the
    // page is open, and `render` puts back whatever scene is current.
    animator.setScene("still");
    about.addEventListener("close", render, { once: true });
  };
  // The index is built on demand and thrown away: 114 rows are cheap to make
  // and would otherwise sit in the DOM for a sitting that never opens it.
  const openPicker = (pick: (surah: number) => void) => {
    const last = prefs.remembersPlace ? validAyah(corpus, prefs.lastRead).surah : null;
    const picker = surahSheet(corpus, last, pick);
    document.body.appendChild(picker);
    picker.showModal();
  };
  // From the START screen nothing is running yet, so choosing a surah IS the
  // start. From the end of a surah the microphone is already open and only the
  // place changes — `start` would refuse, having already run.
  home.onChoose = () => openPicker((surah) => start({ surah, ayah: 1 }));
  // From the end of a surah: the page moves, and the found moment plays over
  // it, as it does when a place is chosen from the start screen.
  const goTo = (at: AyahRef) => {
    if (host.goTo(at)) announce(at, true);
  };
  page.onChoose = () => openPicker((surah) => goTo({ surah, ayah: 1 }));
  page.onContinue = goTo;
  page.onSearchAgain = () => host.searchAgain();
  home.onStart = (from) => start(from);
  listen.onClose = backToStart;
  reader.onClose = backToStart;

  // ---- language ----------------------------------------------------------
  const applyLang = () => {
    const root = document.documentElement;
    root.lang = lang();
    // The interface follows the language; the mushaf sets its own direction.
    root.dir = uiDir();
    home.retitle(prefs.mode, corpus);
    modeBar.retitle();
    listen.retitle();
    reader.retitle();
    setPlace();
    page.retitle();
    meaningSheet.retitle();
    failure.retitle();
    loading.retitle();
    // A sheet carries the language it was built in. The settings sheet is the
    // one that can be open DURING a switch — it holds the switch — so it is
    // rebuilt in place.
    if (settings) openSettings();
  };
  onLangChange(applyLang);
  applyLang();
  listen.setMode(prefs.mode);
  animator.setMode(prefs.mode);

  // ---- boot --------------------------------------------------------------
  try {
    await decoderReady;
  } catch (e) {
    loading.hide();
    view.log(`model: ${e instanceof Error ? e.message : String(e)}`);
    failure.show("modelUnavailable");
    return;
  }
  loading.hide();
  render();
  console.log(`[prompter] ready — crossOriginIsolated=${crossOriginIsolated}`);
  // Only now: the model is in place, so the app shell's precache never
  // competes with the 72 MB download on a first visit.
  enableOffline((line) => view.log(line));

  // ---- text size: slider, pinch, ctrl+wheel -------------------------------
  let repark: number | null = null;
  prefs.onChange(() => {
    applyFont();
    if (repark !== null) clearTimeout(repark);
    repark = window.setTimeout(() => page.repark(), 120);
  });

  // Tap a word to hear it. The player owns "what is sounding"; the page just
  // draws it, so the underline cannot disagree with the audio.
  page.onWordTapped = (surah, ayah, position) => host.speakWord(surah, ayah, position);
  host.onSpeaking = (at) => {
    page.setSpeaking(at ? corpus.wordIndex(at.surah, at.ayah, at.position - 1) : null);
  };

  installPinch(reader.el, prefs);
  window.addEventListener("resize", () => page.repark());
  window.addEventListener("pagehide", () => host.close());

  // The mode decides whether the words start hidden.
  const syncHidden = () => page.setHidden(prefs.hideWords);
  prefs.onChange(syncHidden);
  syncHidden();

  // Only the modes that LOCK to one surah can be stuck at the end of it; the
  // others follow the reciter wherever they go.
  const syncTail = () => page.setTail(prefs.canChooseSurah);
  prefs.onChange(syncTail);
  syncTail();

  // The Latin readings are a 584 KB download, so nothing is asked for until
  // the setting is on. `showTranslit` — not the setting itself — is what is
  // consulted, so switching to review mode takes them off the page without
  // touching what the reciter chose.
  let translitWanted = false;
  const syncTranslit = () => {
    const want = prefs.showTranslit;
    if (want === translitWanted) return;
    translitWanted = want;
    if (!want) {
      page.setTranslit(null);
      return;
    }
    void loadTranslit(corpus.wordCount).then((words) => {
      // The switch may have gone off again, or the mode changed, while this
      // was in the air; the state when it lands is the one that counts. A
      // failed load is `null`, and there is nothing to take off.
      if (words && prefs.showTranslit) page.setTranslit(words);
    });
  };
  prefs.onChange(syncTranslit);
  syncTranslit();

  // The meaning: the translation already picked comes off the device — no
  // download asked for, no progress shown. `showMeaning`, not the setting, is
  // what the sheet acts on, so review mode takes it off the page without
  // touching what the reciter chose.
  const syncMeaning = () => meaningSheet.setEnabled(prefs.showMeaning);
  prefs.onChange(syncMeaning);
  syncMeaning();
  void meanings.restore();

  // A function DECLARATION, not a const: `backToStart` is defined far above
  // this and calls it, and there are `await`s in between — a const would still
  // be in its dead zone if the reciter pressed a button while one was pending.
  function syncOffers(): void {
    home.setResume(prefs.remembersPlace ? validAyah(corpus, prefs.lastRead) : null, corpus);
    home.setCanChoose(prefs.canChooseSurah);
  }
  prefs.onChange(syncOffers);
  syncOffers();

  // `?audio=` has no microphone and no reciter to press anything, so it arms
  // itself — `?audio=/test/fatiha.wav&speed=2` must stay a one-URL test.
  if (dev) start();
}

/**
 * A saved position the corpus can actually show, or الفاتحة ١.
 *
 * `Prefs` parses `prompterLastRead` without a corpus, so it can only bound the
 * surah — an ayah number beyond that surah's length survives it. Storage from
 * a hand-edit or an older corpus then put «آية ٩٩٩٩» on the button, and
 * pressing it threw inside `host.start`, leaving the session started with
 * nothing mounted: only a reload recovered.
 */
function validAyah(corpus: QuranCorpus, at: AyahRef): AyahRef {
  return corpus.hasAyah(at.surah, at.ayah) ? at : { surah: 1, ayah: 1 };
}

/** Two-finger pinch (and ctrl+wheel on desktop) at 30 % sensitivity, like the iOS gesture. */
function installPinch(el: HTMLElement, prefs: Prefs): void {
  let base = prefs.fontMulti;
  let startDist = 0;
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        base = prefs.fontMulti;
        startDist = dist(e.touches);
      }
    },
    { passive: true },
  );
  el.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        const scale = dist(e.touches) / startDist;
        prefs.fontMulti = base + (scale - 1) * 0.3 * 3; // pinch travel is short on a phone
      }
    },
    { passive: false },
  );
  el.addEventListener("touchend", () => (startDist = 0));
  el.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      prefs.fontMulti = prefs.fontMulti - e.deltaY * 0.002;
    },
    { passive: false },
  );
}

main().catch((e) => {
  console.error(e);
  const app = document.getElementById("app");
  if (app) app.textContent = String(e);
});
