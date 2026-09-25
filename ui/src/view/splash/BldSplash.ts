import { SplashScreen } from "./SplashScreen.js";

const splashSheet = new CSSStyleSheet();
splashSheet.replaceSync(`
:host {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  overflow: hidden;
  background: #04060a;
  color: #e8f6ff;
}

:host([hidden]) {
  display: none;
}

.splash-grid,
.splash-scan,
.splash-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.splash-grid {
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.08) 1px, transparent 1px);
  background-size: 48px 48px;
  animation: splash-grid 8s linear infinite;
  mask-image: radial-gradient(circle at center, #000 30%, transparent 75%);
}

.splash-scan {
  background: linear-gradient(180deg, transparent, rgba(56, 189, 248, 0.22), transparent);
  height: 18%;
  animation: splash-scan 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.splash-vignette {
  background: radial-gradient(circle at center, transparent 35%, #04060a 78%);
}

.splash-stage {
  position: relative;
  width: min(320px, 72vw);
  height: min(320px, 72vw);
  display: grid;
  place-items: center;
}

.splash-ring,
.splash-orbit {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.splash-ring-outer {
  inset: 0;
  border: 1px dashed rgba(56, 189, 248, 0.55);
  box-shadow: 0 0 24px rgba(56, 189, 248, 0.25), inset 0 0 24px rgba(56, 189, 248, 0.12);
  animation: splash-spin 12s linear infinite;
}

.splash-ring-inner {
  inset: 18px;
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-left-color: transparent;
  border-bottom-color: transparent;
  animation: splash-spin 7s linear infinite reverse;
}

.splash-orbit {
  inset: 8px;
  animation: splash-spin 4.5s linear infinite;
}

.splash-orbit span {
  position: absolute;
  top: 0;
  left: 50%;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: #fef08a;
  box-shadow: 0 0 12px #f59e0b;
}

.splash-mark {
  width: min(196px, 46vw);
  height: min(196px, 46vw);
  animation: splash-glow 1.6s ease-in-out infinite;
}

.splash-readout {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: min(320px, 78vw);
  padding: 16px 18px 18px;
  background: rgba(8, 12, 20, 0.72);
  border: 1px solid rgba(56, 189, 248, 0.35);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.15), 0 0 32px rgba(56, 189, 248, 0.12);
}

.splash-title,
.splash-status {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.42em;
}

.splash-title {
  font-size: 14px;
  color: #f8fafc;
}

.splash-status {
  font-size: 11px;
  color: #38bdf8;
}

.splash-status::after {
  content: "▮";
  margin-left: 8px;
  color: #f59e0b;
  animation: splash-blink 1s steps(1) infinite;
}

wa-spinner {
  font-size: 28px;
  --track-color: rgba(56, 189, 248, 0.2);
  --indicator-color: #38bdf8;
  --speed: 0.8s;
}

wa-progress-bar {
  width: 100%;
  --track-height: 3px;
  --track-color: rgba(56, 189, 248, 0.16);
  --indicator-color: #38bdf8;
}

.splash-corner {
  position: absolute;
  width: 28px;
  height: 28px;
  border: 2px solid rgba(56, 189, 248, 0.7);
  pointer-events: none;
}

.splash-corner-nw { top: 18px; left: 18px; border-right: 0; border-bottom: 0; }
.splash-corner-ne { top: 18px; right: 18px; border-left: 0; border-bottom: 0; }
.splash-corner-sw { bottom: 18px; left: 18px; border-right: 0; border-top: 0; }
.splash-corner-se { bottom: 18px; right: 18px; border-left: 0; border-top: 0; }

@keyframes splash-spin {
  to { transform: rotate(360deg); }
}

@keyframes splash-scan {
  0% { transform: translateY(-120%); }
  100% { transform: translateY(560%); }
}

@keyframes splash-grid {
  to { background-position: 48px 48px; }
}

@keyframes splash-glow {
  0%, 100% { filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.25)); }
  50% { filter: drop-shadow(0 0 22px rgba(56, 189, 248, 0.85)); }
}

@keyframes splash-blink {
  50% { opacity: 0; }
}
`);

const splashMarkup = `
  <div class="splash-grid" aria-hidden="true"></div>
  <div class="splash-scan" aria-hidden="true"></div>
  <div class="splash-vignette" aria-hidden="true"></div>
  <span class="splash-corner splash-corner-nw" aria-hidden="true"></span>
  <span class="splash-corner splash-corner-ne" aria-hidden="true"></span>
  <span class="splash-corner splash-corner-sw" aria-hidden="true"></span>
  <span class="splash-corner splash-corner-se" aria-hidden="true"></span>
  <div class="splash-stage">
    <div class="splash-ring splash-ring-outer" aria-hidden="true"></div>
    <div class="splash-ring splash-ring-inner" aria-hidden="true"></div>
    <div class="splash-orbit" aria-hidden="true"><span></span></div>
    <wa-animation name="pulse" play duration="1400" easing="ease-in-out">
      <img class="splash-mark" src="/icons/bld.svg" alt="" width="196" height="196" />
    </wa-animation>
  </div>
  <wa-card class="splash-card" appearance="plain">
    <div class="splash-readout">
      <p class="splash-title">BLD</p>
      <p class="splash-status">INITIALIZING</p>
      <wa-spinner></wa-spinner>
      <wa-progress-bar indeterminate label="Loading bld"></wa-progress-bar>
    </div>
  </wa-card>
`;

/** Full-screen loading custom element. Markup and styles live in its shadow root. */
export class BldSplash extends HTMLElement {
  static readonly tagName = "bld-splash";
  readonly #screen: SplashScreen;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [splashSheet];
    root.innerHTML = splashMarkup;
    this.#screen = new SplashScreen(this, globalThis);
  }

  connectedCallback(): void {
    this.dataset.state ??= "open";
    this.setAttribute("role", "status");
    this.setAttribute("aria-live", "polite");
    this.setAttribute("aria-label", "Loading bld");
  }

  /** Close after the parsed workspace has been shown. */
  shown(): void {
    this.#screen.shown();
  }
}

if (typeof customElements !== "undefined" && customElements.get(BldSplash.tagName) === undefined) {
  customElements.define(BldSplash.tagName, BldSplash);
}
