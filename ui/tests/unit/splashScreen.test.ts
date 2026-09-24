import { expect, test } from "vitest";
import { SplashScreen, type LoadClock, type SplashElement } from "../../src/view/splash/SplashScreen.js";

class MemorySplash implements SplashElement {
  dataset: { state?: string } = { state: "open" };
  hidden = false;
  readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class ManualClock implements LoadClock {
  readyState: DocumentReadyState = "loading";
  private loadListener: (() => void) | undefined;
  private scheduled: { delay: number; run: () => void } | undefined;

  addEventListener(type: "load", listener: () => void): void {
    expect(type).toBe("load");
    this.loadListener = listener;
  }

  setTimeout(handler: () => void, timeout: number): number {
    this.scheduled = { delay: timeout, run: handler };
    return 1;
  }

  finishLoad(): void {
    this.readyState = "complete";
    this.loadListener?.();
  }

  elapse(): void {
    const scheduled = this.scheduled;
    this.scheduled = undefined;
    scheduled?.run();
  }

  pendingDelay(): number | undefined {
    return this.scheduled?.delay;
  }
}

test("closes the splash 100 ms after the load event", () => {
  const splash = new MemorySplash();
  const clock = new ManualClock();
  new SplashScreen(splash, clock).arm();

  expect(splash.hidden).toBe(false);
  expect(splash.dataset.state).toBe("open");
  expect(clock.pendingDelay()).toBeUndefined();

  clock.finishLoad();
  expect(clock.pendingDelay()).toBe(SplashScreen.dismissDelayMs);
  expect(splash.hidden).toBe(false);

  clock.elapse();
  expect(splash.hidden).toBe(true);
  expect(splash.dataset.state).toBe("closed");
  expect(splash.attributes.get("aria-hidden")).toBe("true");
});

test("closes 100 ms later when the page has already loaded", () => {
  const splash = new MemorySplash();
  const clock = new ManualClock();
  clock.readyState = "complete";
  new SplashScreen(splash, clock).arm();

  expect(clock.pendingDelay()).toBe(100);
  expect(splash.hidden).toBe(false);
  clock.elapse();
  expect(splash.dataset.state).toBe("closed");
});
