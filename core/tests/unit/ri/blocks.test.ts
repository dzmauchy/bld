import { describe, expect, test } from "vitest";
import { push } from "../../../src/ri/blocks";
import { RiExecutionContext } from "../../../src/ri/runtime";

describe("RI Block Unit Tests", () => {
  describe("transformers: cos_f32", () => {
    test("transforms value via cos32 and calls consumers", () => {
      const ctx = new RiExecutionContext();
      const cosBlock = new push.f32.transformers.cos_f32(ctx, 1);
      const received: number[] = [];
      const [inputFn] = cosBlock.apply([(v) => received.push(v)]);

      inputFn(0);
      expect(received).toEqual([1]);

      inputFn(Math.PI);
      expect(received[1]).toBeCloseTo(-1, 5);
    });

    test("fans out transformed value to multiple consumers", () => {
      const ctx = new RiExecutionContext();
      const cosBlock = new push.f32.transformers.cos_f32(ctx, 1);
      const rec1: number[] = [];
      const rec2: number[] = [];
      const [inputFn] = cosBlock.apply([(v) => rec1.push(v), (v) => rec2.push(v)]);

      inputFn(0);
      expect(rec1).toEqual([1]);
      expect(rec2).toEqual([1]);
    });
  });

  describe("transformers: sin_f32", () => {
    test("transforms value via sin32 and calls consumers", () => {
      const ctx = new RiExecutionContext();
      const sinBlock = new push.f32.transformers.sin_f32(ctx, 1);
      const received: number[] = [];
      const [inputFn] = sinBlock.apply([(v) => received.push(v)]);

      inputFn(0);
      expect(received).toEqual([0]);

      inputFn(Math.PI / 2);
      expect(received[1]).toBeCloseTo(1, 5);
    });
  });

  describe("transformers: product_f32", () => {
    test("computes product of vector inputs on interval tick", () => {
      const ctx = new RiExecutionContext();
      const prodBlock = new push.f32.transformers.product_f32(ctx, 1, 10);
      const received: number[] = [];
      const [vectorFactory] = prodBlock.apply([(v) => received.push(v)]);
      const [in0, in1] = vectorFactory(2);

      ctx.start();
      // Initially values are NaN, tick should not emit
      ctx.tick(10);
      expect(received).toHaveLength(0);

      // Provide both inputs
      in0(3);
      in1(4);
      ctx.tick(10);
      expect(received).toEqual([12]);

      // Update one input
      in0(5);
      ctx.tick(10);
      expect(received).toEqual([12, 20]);
    });

    test("handles N-channel vectorization", () => {
      const ctx = new RiExecutionContext();
      const prodBlock = new push.f32.transformers.product_f32(ctx, 1, 10);
      const received: number[] = [];
      const [vectorFactory] = prodBlock.apply([(v) => received.push(v)]);
      const inputs = vectorFactory(4);

      ctx.start();
      inputs[0](2);
      inputs[1](3);
      inputs[2](4);
      inputs[3](5);
      ctx.tick(10);
      expect(received).toEqual([120]);
    });

    test("stops interval on close", () => {
      const ctx = new RiExecutionContext();
      const prodBlock = new push.f32.transformers.product_f32(ctx, 1, 10);
      const received: number[] = [];
      const [vectorFactory] = prodBlock.apply([(v) => received.push(v)]);
      const [in0] = vectorFactory(1);

      ctx.start();
      in0(7);
      ctx.tick(10);
      expect(received).toEqual([7]);

      ctx.close();
      expect(ctx.activeIntervalCount()).toBe(0);
      in0(10);
      ctx.tick(10);
      expect(received).toEqual([7]);
    });
  });

  describe("transformers: sum_f32", () => {
    test("computes sum of vector inputs on interval tick", () => {
      const ctx = new RiExecutionContext();
      const sumBlock = new push.f32.transformers.sum_f32(ctx, 1, 15);
      const received: number[] = [];
      const [vectorFactory] = sumBlock.apply([(v) => received.push(v)]);
      const [in0, in1, in2] = vectorFactory(3);

      ctx.start();
      in0(10);
      in1(20);
      in2(35);
      ctx.tick(15);
      expect(received).toEqual([65]);

      in1(5);
      ctx.tick(15);
      expect(received).toEqual([65, 50]);
    });

    test("stops interval on close", () => {
      const ctx = new RiExecutionContext();
      const sumBlock = new push.f32.transformers.sum_f32(ctx, 1, 10);
      const [factory] = sumBlock.apply([]);
      factory(1);
      ctx.start();
      expect(ctx.activeIntervalCount()).toBe(1);
      ctx.close();
      expect(ctx.activeIntervalCount()).toBe(0);
    });
  });

  describe("sinks: scope_f32", () => {
    test("records vector inputs to execution context sendF32", () => {
      const ctx = new RiExecutionContext();
      const scope = new push.f32.sinks.scope_f32(ctx, 42, 60, 10);
      const [sinkFactory] = scope.apply();
      const [ch0, ch1, ch2] = sinkFactory(3);

      ch0(1.5);
      expect(ctx.lastPin(42, 0)).toBe(1.5);
      expect(ctx.hasPin(42, 0)).toBe(true);

      ch1(9.25);
      expect(ctx.lastPin(42, 1)).toBe(9.25);

      ch2(-42);
      expect(ctx.lastPin(42, 2)).toBe(-42);
    });
  });

  describe("sources: const_f32", () => {
    test("pushes configured value to all consumers on start", () => {
      const ctx = new RiExecutionContext();
      const c = new push.f32.sources.const_f32(ctx, 1, 42.5);
      const rec1: number[] = [];
      const rec2: number[] = [];
      c.apply([(v) => rec1.push(v), (v) => rec2.push(v)]);

      expect(rec1).toHaveLength(0);
      ctx.start();
      expect(rec1).toEqual([42.5]);
      expect(rec2).toEqual([42.5]);
    });
  });

  describe("sources: gpio_in_f32", () => {
    test("binary searches configured pins and dispatches to matching consumer", () => {
      const ctx = new RiExecutionContext();
      const pins = new Uint8Array([2, 5, 9]);
      const gpio = new push.f32.sources.gpio_in_f32(ctx, 1, 0, pins);
      const rec0: number[] = [];
      const rec1: number[] = [];
      const rec2: number[] = [];

      gpio.apply([
        [(v) => rec0.push(v)], // pin 2
        [(v) => rec1.push(v)], // pin 5
        [(v) => rec2.push(v)], // pin 9
      ]);

      ctx.start();
      expect(ctx.activeGpioListenerCount()).toBe(1);

      // Trigger pin 5 with true (1)
      ctx.emitGpio(0, 5, true);
      expect(rec0).toHaveLength(0);
      expect(rec1).toEqual([1]);
      expect(rec2).toHaveLength(0);

      // Trigger pin 2 with false (0)
      ctx.emitGpio(0, 2, false);
      expect(rec0).toEqual([0]);

      // Trigger non-matching pin 7 (should be ignored)
      ctx.emitGpio(0, 7, true);
      expect(rec0).toEqual([0]);
      expect(rec1).toEqual([1]);
      expect(rec2).toHaveLength(0);
    });

    test("stops listening on close", () => {
      const ctx = new RiExecutionContext();
      const gpio = new push.f32.sources.gpio_in_f32(ctx, 1, 0, new Uint8Array([1]));
      const rec: number[] = [];
      gpio.apply([[(v) => rec.push(v)]]);
      ctx.start();
      expect(ctx.activeGpioListenerCount()).toBe(1);

      ctx.close();
      expect(ctx.activeGpioListenerCount()).toBe(0);
      ctx.emitGpio(0, 1, true);
      expect(rec).toHaveLength(0);
    });
  });

  describe("sources: cos_gen_f32", () => {
    test("generates cosine values over time", () => {
      const ctx = new RiExecutionContext();
      const gen = new push.f32.sources.cos_gen_f32(ctx, 1, 10, 1, 2, 0); // amplitude 2
      const received: number[] = [];
      gen.apply([(v) => received.push(v)]);

      ctx.start();
      // t = 0 -> 2 * cos(0) = 2
      ctx.setNow(0);
      ctx.tick(0);
      expect(received[0]).toBeCloseTo(2, 4);

      // t = 1000ms (1 rad in 1 Hz, with 2pi frequency: elapsedSec * freq * 2pi)
      // 1 sec = 2pi rad -> cos(2pi) = 1 -> 2 * 1 = 2
      ctx.setNow(1000);
      ctx.tick(0);
      expect(received[1]).toBeCloseTo(2, 4);

      // t = 500ms -> pi rad -> cos(pi) = -1 -> 2 * -1 = -2
      ctx.setNow(500);
      ctx.tick(0);
      expect(received[2]).toBeCloseTo(-2, 4);
    });
  });

  describe("sources: sin_gen_f32", () => {
    test("generates sine values over time", () => {
      const ctx = new RiExecutionContext();
      const gen = new push.f32.sources.sin_gen_f32(ctx, 1, 10, 1, 3, 0); // amplitude 3
      const received: number[] = [];
      gen.apply([(v) => received.push(v)]);

      ctx.start();
      // t = 0 -> 3 * sin(0) = 0
      ctx.setNow(0);
      ctx.tick(0);
      expect(received[0]).toBeCloseTo(0, 4);

      // t = 250ms -> pi/2 rad -> sin(pi/2) = 1 -> 3 * 1 = 3
      ctx.setNow(250);
      ctx.tick(0);
      expect(received[1]).toBeCloseTo(3, 4);
    });
  });

  describe("sources: rand_gen_f32", () => {
    test("generates random values scaled by amplitude", () => {
      const ctx = new RiExecutionContext();
      const gen = new push.f32.sources.rand_gen_f32(ctx, 1, 10, 5); // amplitude 5
      const received: number[] = [];
      gen.apply([(v) => received.push(v)]);

      ctx.start();
      ctx.setRandom(0.4);
      ctx.tick(10);
      expect(received[0]).toBeCloseTo(2.0, 4);

      ctx.setRandom(0.8);
      ctx.tick(10);
      expect(received[1]).toBeCloseTo(4.0, 4);
    });
  });

  describe("sources: pulse_gen_f32", () => {
    test("generates pulse switching between amplitude and 0 based on duty cycle", () => {
      const ctx = new RiExecutionContext();
      // frequency = 1 Hz (period 1000ms), duty_cycle = 0.25, amplitude = 5
      const gen = new push.f32.sources.pulse_gen_f32(ctx, 1, 0.25, 5, 1, 0);
      const received: number[] = [];
      gen.apply([(v) => received.push(v)]);

      ctx.start();

      // t = 0 -> progress 0 < 0.25 -> 5
      ctx.setNow(0);
      ctx.tick(0);
      expect(received[received.length - 1]).toBe(5);

      // t = 200ms -> progress 0.2 < 0.25 -> 5
      ctx.setNow(200);
      ctx.tick(0);
      expect(received[received.length - 1]).toBe(5);

      // t = 300ms -> progress 0.3 > 0.25 -> 0
      ctx.setNow(300);
      ctx.tick(0);
      expect(received[received.length - 1]).toBe(0);

      // t = 1000ms -> new period start -> 5
      ctx.setNow(1000);
      ctx.tick(0);
      expect(received[received.length - 1]).toBe(5);
    });
  });
});
