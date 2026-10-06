/**
 * A pill at the top of the screen that says, in words, why the sitting just
 * changed course — «انتهت السورة — عدتُ للاستماع», «تابع مع سورة البقرة». One
 * at a time: a newer one replaces the old rather than stacking under it.
 */
export class Toast {
  private el: HTMLDivElement | null = null;
  private timer: number | null = null;

  show(text: string, ms = 2600): void {
    this.hide();
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    this.el = el;
    // A live region is only listened to once it is on the page: text written
    // in the same moment it arrives goes unannounced by VoiceOver. So it goes
    // in empty, and the words follow a frame later.
    requestAnimationFrame(() => {
      if (this.el === el) el.textContent = text;
    });
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.el?.remove();
    this.el = null;
  }
}
