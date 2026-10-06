import { icon } from "../icons.js";
import { t } from "../strings.js";
import { label, roundButton } from "./home.js";

export type FailureKind = "micDenied" | "micUnavailable" | "modelUnavailable" | "interrupted";

/**
 * A ringed mic-slash, a title, the reason, and «إعادة المحاولة» — plus a ×
 * back to the start screen. The old failure screen sat under the top bar, so
 * settings, the About page and the modes were still in reach; a full-screen
 * layer with no way out would make a denied microphone a dead end.
 */
export class FailureScreen {
  readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly btn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private kind: FailureKind | null = null;
  constructor(onRetry: () => void, onClose: () => void) {
    this.el = document.createElement("div");
    this.el.className = "layer failure";
    this.el.dataset.hidden = "1";
    this.el.setAttribute("role", "alert");
    this.closeBtn = roundButton("close", "lg x");
    this.closeBtn.onclick = onClose;
    const ic = document.createElement("div");
    ic.className = "ficon";
    ic.innerHTML = icon("micSlash");
    this.title = document.createElement("div");
    this.title.className = "ftitle";
    this.body = document.createElement("div");
    this.body.className = "fbody";
    this.btn = document.createElement("button");
    this.btn.className = "cta";
    this.btn.type = "button";
    // A model that never loaded cannot be retried from inside the page: the
    // decoder has no session to resume, and `onRetry` only restarts listening,
    // so the screen went away and left an app that could hear nothing. A
    // reload is what fetches the model again — and what the text asks for.
    this.btn.onclick = () => (this.kind === "modelUnavailable" ? location.reload() : onRetry());
    this.el.append(this.closeBtn, ic, this.title, this.body, this.btn);
  }
  show(kind: FailureKind | null): void {
    this.kind = kind;
    if (!kind) {
      this.el.dataset.hidden = "1";
      return;
    }
    this.retitle();
    // A denied permission is not something a retry can fix — only the
    // browser's own settings can — so the button would be a promise it breaks.
    this.btn.hidden = kind === "micDenied";
    this.el.dataset.hidden = "0";
  }
  retitle(): void {
    this.btn.textContent = t().tryAgain;
    label(this.closeBtn, t().restart);
    if (!this.kind) return;
    const e = t().errors[this.kind];
    this.title.textContent = e.title;
    this.body.textContent = e.body;
  }
}

/** The model-download overlay shown once, before anything else. */
export class LoadingOverlay {
  readonly el: HTMLDivElement;
  private readonly spin: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly msg: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  /**
   * Whether this visit is genuinely DOWNLOADING the model. A cached model
   * comes back from the Cache API without one progress event, so the first
   * such event is the proof — and until it arrives the overlay shows only
   * the quiet spinner. Announcing «first visit only» to every returning
   * visitor made a two-second cache read look like a 72 MB download.
   */
  private downloading = false;
  constructor() {
    this.el = document.createElement("div");
    this.el.className = "layer loading";
    // The quiet phase is a ring, not the progress bar: a bar with nothing to
    // report reads as a bar that is stuck. The bar appears only once real
    // download progress exists to show.
    this.spin = document.createElement("div");
    this.spin.className = "spinner";
    this.bar = document.createElement("div");
    this.bar.className = "bar";
    this.bar.dataset.hidden = "1";
    this.fill = document.createElement("div");
    this.bar.appendChild(this.fill);
    this.msg = document.createElement("div");
    this.msg.className = "msg";
    this.sub = document.createElement("div");
    this.sub.className = "msg";
    this.el.append(this.spin, this.bar, this.msg, this.sub);
  }
  retitle(): void {
    if (!this.downloading) return;
    this.msg.textContent = t().loadingModel;
    this.sub.textContent = t().loadingFirst;
  }
  progress(loaded: number, total: number): void {
    if (!this.downloading) {
      this.downloading = true;
      this.spin.dataset.hidden = "1";
      delete this.bar.dataset.hidden;
      this.retitle();
    }
    this.fill.style.width = total > 0 ? `${Math.min(100, (100 * loaded) / total).toFixed(1)}%` : "30%";
  }
  hide(): void {
    this.el.dataset.hidden = "1";
  }
}
