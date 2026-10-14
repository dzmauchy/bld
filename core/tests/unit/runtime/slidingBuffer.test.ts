import { describe, expect, test } from "vitest";
import { SlidingScopeBuffer, SlidingScopeBufferF64 } from "core";

describe("SlidingScopeBuffer", () => {
  const window = (buffer: SlidingScopeBuffer | SlidingScopeBufferF64) =>
    Array.from({ length: buffer.capacity }, (_, index) => buffer.at(index));

  test("stores values with a single write pointer", () => {
    const buffer = new SlidingScopeBuffer(3);
    const storage = buffer.data;
    expect(window(buffer)).toEqual([NaN, NaN, NaN]);
    buffer.push(1);
    buffer.push(2);
    expect(buffer.pointer).toBe(2);
    expect(buffer.size).toBe(2);
    expect(buffer.last()).toBe(2);
    expect(window(buffer)).toEqual([NaN, 1, 2]);
    expect(buffer.data).toBe(storage);
    expect([...storage]).toEqual([1, 2, NaN]);
  });

  test("wraps and overwrites the oldest sample", () => {
    const buffer = new SlidingScopeBuffer(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4);
    expect(buffer.size).toBe(3);
    expect(buffer.pointer).toBe(1);
    expect(window(buffer)).toEqual([2, 3, 4]);
    expect(buffer.at(0)).toBe(2);
    expect(buffer.last()).toBe(4);
  });

  test("derives capacity from scope period and precision", () => {
    const f32: SlidingScopeBuffer = SlidingScopeBuffer.fromPeriod(1, 100);
    const f64: SlidingScopeBufferF64 = SlidingScopeBufferF64.fromPeriod(1, 100);
    expect(f32.capacity).toBe(10);
    expect(f64.capacity).toBe(10);
    expect(f32.data).toBeInstanceOf(Float32Array);
    expect(f64.data).toBeInstanceOf(Float64Array);
  });

  test("f64 buffer uses Float64Array", () => {
    const buffer = SlidingScopeBufferF64.fromPeriod(0.2, 100);
    const value = 1 + Number.EPSILON;
    buffer.push(value);
    expect(buffer.data).toBeInstanceOf(Float64Array);
    expect(buffer.last()).toBe(value);
  });

  test("empty buffer reports NaN and ignores pushes into zero capacity", () => {
    const empty = new SlidingScopeBuffer(0);
    empty.push(1);
    expect(empty.size).toBe(0);
    expect(empty.last()).toBeNaN();
    expect(empty.at(0)).toBeNaN();
    expect(window(empty)).toEqual([]);

    const buffer = new SlidingScopeBuffer(2);
    expect(buffer.last()).toBeNaN();
    expect(window(buffer)).toEqual([NaN, NaN]);
    buffer.push(9);
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.pointer).toBe(0);
    expect(buffer.last()).toBeNaN();
  });
});
