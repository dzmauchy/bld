import { expect, test } from "vitest";
import { ScopeMonitor } from "ui/view/scope/scopeCapture.ts";
import { ScopePlotGeometry } from "ui/view/scope/scopePlotGeometry.ts";

test("measures the output-sized input vector using one shared pointer for all channels", () => {
  const monitor = new ScopeMonitor("scope", "Scope", 0.04, 0.01, "f32", 4);
  monitor.syncChannels([{ channel: 0, label: "signal" }, { channel: 1, label: "pending" }]);
  const trace = monitor.series()[0]!;
  const storage = trace.buffer.data;
  const pending = monitor.series()[1]!;
  expect(monitor.inputSize).toBe(2);
  expect(monitor.inputAt(0)).toBeNaN();
  expect(monitor.inputAt(1)).toBeNaN();
  const window = () => Array.from({ length: trace.buffer.capacity }, (_, index) => trace.buffer.at(index));
  expect(window()).toEqual([NaN, NaN, NaN, NaN]);
  monitor.accept(0, -1);
  monitor.accept(0, 0);
  monitor.accept(0, 1);
  expect(monitor.inputAt(0)).toBe(1);
  expect(monitor.pointer).toBe(0);
  expect(pending.buffer.data.every(value => Number.isNaN(value))).toBe(true);
  expect(monitor.sample(5)).toBe(false);
  expect(window()).toEqual([NaN, NaN, NaN, NaN]);
  expect(monitor.sample(5)).toBe(true);
  expect(window()).toEqual([NaN, NaN, NaN, 1]);
  expect(monitor.pointer).toBe(1);
  expect(monitor.series()[1]!.buffer.last()).toBeNaN();
  const plot = ScopePlotGeometry.fromMonitor(monitor);
  expect(plot.series[0]!.buffer).toBe(trace.buffer);
  expect(plot.axisSeconds).toBe(0.04);
  expect(plot.sampleTime(plot.series[0]!, 3)).toBe(0.04);
  for (const value of [2, 3, 4, 5]) {
    monitor.accept(0, value);
    monitor.accept(1, -value);
    monitor.sample(10);
  }
  expect(trace.buffer.data).toBe(storage);
  expect(monitor.pointer).toBe(1);
  expect(window()).toEqual([2, 3, 4, 5]);
  expect(Array.from({ length: 4 }, (_, index) => pending.buffer.at(index))).toEqual([-2, -3, -4, -5]);
  expect(plot.series[0]!.buffer.last()).toBe(5);
  expect(ScopePlotGeometry.fromMonitor(monitor).axisSeconds).toBe(0.04);
  monitor.clear();
  expect(monitor.pointer).toBe(0);
  expect(trace.buffer.data).toBe(storage);
  expect(window()).toEqual([NaN, NaN, NaN, NaN]);
  expect(monitor.inputAt(0)).toBeNaN();
  expect(monitor.inputAt(1)).toBeNaN();
});

test.each(["f32", "f64"] as const)("incoming %s values update only the input vector until the timer measures it", precision => {
  const monitor = new ScopeMonitor("scope", "Scope", 1, 0.01, precision, 100);
  monitor.syncChannels([{ channel: 0, label: "a" }, { channel: 1, label: "b" }, { channel: 2, label: "c" }]);
  const value = 1.0000000001;
  monitor.accept(2, value);
  expect(monitor.inputSize).toBe(3);
  expect(monitor.inputAt(2)).toBe(precision === "f32" ? Math.fround(value) : value);
  expect(monitor.pointer).toBe(0);
  expect(monitor.size).toBe(0);
  const trace = monitor.series()[2]!;
  expect(trace.buffer.data).toBeInstanceOf(precision === "f32" ? Float32Array : Float64Array);
  expect(trace.buffer.last()).toBeNaN();
  monitor.sample(10);
  expect(monitor.pointer).toBe(1);
  expect(trace.buffer.last()).toBe(monitor.inputAt(2));
});
