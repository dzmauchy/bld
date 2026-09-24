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
  private scheduled: { delay: number; run: () => void } | undefined;

  setTimeout(handler: () => void, timeout: number): number {
    this.scheduled = { delay: timeout, run: handler };
    return 1;
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

test("closes the splash 100 ms after the parsed workspace is shown", () => {
  const splash = new MemorySplash();
  const clock = new ManualClock();
  const screen = new SplashScreen(splash, clock);

  expect(splash.hidden).toBe(false);
  expect(clock.pendingDelay()).toBeUndefined();

  screen.shown();
  expect(clock.pendingDelay()).toBe(SplashScreen.dismissDelayMs);
  expect(splash.hidden).toBe(false);

  screen.shown();
  expect(clock.pendingDelay()).toBe(SplashScreen.dismissDelayMs);

  clock.elapse();
  expect(splash.hidden).toBe(true);
  expect(splash.dataset.state).toBe("closed");
  expect(splash.attributes.get("aria-hidden")).toBe("true");
});
