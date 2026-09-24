/** Element the splash screen shows and later hides. */
export interface SplashElement {
  dataset: { state?: string };
  hidden: boolean | string;
  setAttribute(name: string, value: string): void;
}

/** Clock that reports document readiness and can schedule the dismiss delay. */
export interface LoadClock {
  readonly readyState: DocumentReadyState;
  addEventListener(type: "load", listener: () => void, options?: { once: true }): void;
  setTimeout(handler: () => void, timeout: number): number;
}

/** Dismisses the splash 100 ms after the page `load` event. */
export class SplashScreen {
  static readonly dismissDelayMs = 100;

  constructor(
    private readonly element: SplashElement,
    private readonly clock: LoadClock,
  ) {}

  /** Wait for `load`, then close after {@link SplashScreen.dismissDelayMs}. */
  arm(): void {
    const dismiss = () => {
      this.clock.setTimeout(() => this.close(), SplashScreen.dismissDelayMs);
    };
    if (this.clock.readyState === "complete") dismiss();
    else this.clock.addEventListener("load", dismiss, { once: true });
  }

  close(): void {
    this.element.dataset.state = "closed";
    this.element.hidden = true;
    this.element.setAttribute("aria-hidden", "true");
  }
}

/** Load clock bound to the browser window. */
export class WindowLoadClock implements LoadClock {
  constructor(private readonly view: Window = window) {}

  get readyState(): DocumentReadyState {
    return this.view.document.readyState;
  }

  addEventListener(type: "load", listener: () => void, options?: { once: true }): void {
    this.view.addEventListener(type, listener, options);
  }

  setTimeout(handler: () => void, timeout: number): number {
    return this.view.setTimeout(handler, timeout);
  }
}
