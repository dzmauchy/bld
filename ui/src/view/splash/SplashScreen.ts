/** Element the splash screen shows and later hides. */
export interface SplashElement {
  dataset: { state?: string };
  hidden: boolean | string;
  setAttribute(name: string, value: string): void;
}

/** Clock that can schedule the dismiss delay after the workspace is shown. */
export interface LoadClock {
  setTimeout(handler: () => void, timeout: number): number;
}

/**
 * Keeps the splash up through library parsing, then closes it 100 ms after
 * the parsed workspace has been shown.
 */
export class SplashScreen {
  static readonly dismissDelayMs = 100;
  private armed = false;

  constructor(
    private readonly element: SplashElement,
    private readonly clock: LoadClock,
  ) {}

  /** Close {@link SplashScreen.dismissDelayMs} after the parsed view is shown. */
  shown(): void {
    if (this.armed) return;
    this.armed = true;
    this.clock.setTimeout(() => this.close(), SplashScreen.dismissDelayMs);
  }

  close(): void {
    this.element.dataset.state = "closed";
    this.element.hidden = true;
    this.element.setAttribute("aria-hidden", "true");
  }
}
