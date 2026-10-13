import { afterEach, expect, test, vi } from "vitest";
import { ScopeMonitor } from "ui/view/scope/scopeCapture.ts";
import { ScopePlotGeometry } from "ui/view/scope/scopePlotGeometry.ts";
import { ScopePlotLayout } from "ui/view/scope/scopePlotLayout.ts";
import { DisplayRevision } from "ui/view/run/displayRevision.ts";

afterEach(() => vi.useRealTimers());

test("preserves short signal peaks while bounding dense trace drawing by screen width", () => {
  const monitor = new ScopeMonitor("scope", "Scope", 10, 0.001, "f32", 10000);
  monitor.syncChannels([{ channel: 0, label: "signal" }]);
  for (let index = 0; index < monitor.capacity; index++) {
    monitor.accept(0, index === 123 ? 10 : index === 456 ? -10 : 0);
    monitor.sample(1);
  }
  const geometry = ScopePlotGeometry.fromMonitor(monitor);
  const path = new ScopePlotLayout(1000, 200).tracePath(geometry, geometry.series[0]!);
  const points = Array.from(path.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g), match => ({ x: Number(match[1]), y: Number(match[2]) }));
  expect(points.length).toBeLessThan(4 * 1000);
  expect(points.some(point => point.y < 30)).toBe(true);
  expect(points.some(point => point.y > 150)).toBe(true);
  expect(points.every((point, index) => index === 0 || point.x >= points[index - 1]!.x)).toBe(true);
  expect(monitor.series()[0]!.buffer.data[123]).toBe(10);
  expect(monitor.series()[0]!.buffer.data[456]).toBe(-10);
});

test("NaN samples break the trace rather than drawing across missing data", () => {
  const monitor = new ScopeMonitor("scope", "Scope", 0.008, 0.001, "f32", 8);
  monitor.syncChannels([{ channel: 0, label: "signal" }]);
  for (const value of [0, 1, NaN, 2, 3, NaN, -1, 0]) {
    monitor.accept(0, value);
    monitor.sample(1);
  }
  const geometry = ScopePlotGeometry.fromMonitor(monitor);
  const path = new ScopePlotLayout(1000, 200).tracePath(geometry, geometry.series[0]!);
  expect(path.match(/M/g)).toHaveLength(3);
  expect(path.match(/L/g)).toHaveLength(6);
});

test("coalesces display refreshes and flushes the last measured sample on Stop", () => {
  vi.useFakeTimers();
  const rendered: number[] = [];
  const display = new DisplayRevision(value => rendered.push(value));
  for (let sample = 1; sample <= 100; sample++) {
    display.update(sample);
    vi.advanceTimersByTime(10);
  }
  expect(rendered.length).toBeLessThanOrEqual(30);
  expect(rendered.at(-1)).toBe(100);
  display.update(101);
  display.flush();
  expect(rendered.at(-1)).toBe(101);
  const count = rendered.length;
  vi.advanceTimersByTime(1000);
  expect(rendered).toHaveLength(count);
});
