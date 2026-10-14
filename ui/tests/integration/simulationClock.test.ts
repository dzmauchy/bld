import { afterEach, expect, test, vi } from "vitest";
import { SimulationClock } from "ui/view/run/sessionClock.ts";

afterEach(() => vi.useRealTimers());

test("keeps sample time uniform when rendering or worker calls delay a tick", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const times: number[] = [];
  const errors: unknown[] = [];
  let delay = 0;
  const clock = new SimulationClock({
    emitGpioIn: async () => 0,
    setNow: async time => { times.push(time); return 0; },
    tick: async () => { vi.advanceTimersByTime(delay); return 0; },
    close: async () => 0,
    activeIntervalCount: async () => 1,
    intervalPeriodAt: async () => 10,
  }, 10, () => undefined, error => errors.push(error));
  clock.start();
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersToNextTimerAsync();
  delay = 240;
  await vi.advanceTimersToNextTimerAsync();
  await vi.advanceTimersToNextTimerAsync();
  delay = 0;
  await vi.advanceTimersToNextTimerAsync();
  clock.stop();
  expect(times.slice(0, 5)).toEqual([10, 20, 30, 40, 50]);
  expect(times.every((time, index) => time === (index + 1) * 10)).toBe(true);
  expect(errors).toEqual([]);
  const count = times.length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(times).toHaveLength(count);
});
