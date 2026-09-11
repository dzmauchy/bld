import { afterEach, describe, expect, test, vi } from "vitest";
import type { ExecutionContext } from "./context.js";
import { diagram } from "./diagram.js";

type PinWrite = { blockId: number; pin: number; v: number };

function createDiagram() {
  let nextIntervalId = 1;
  let nowMs = 0n;
  const intervals = new Map<number, { period: number; callback: () => void }>();
  const closeHandlers: Array<() => void> = [];
  const pinWrites: PinWrite[] = [];
  const worker = new EventTarget();
  vi.stubGlobal("self", worker);

  const ec: ExecutionContext = {
    setInterval(period, callback) {
      const id = nextIntervalId++;
      intervals.set(id, { period, callback });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    onClose(callback) {
      closeHandlers.push(callback);
    },
    sendPinF64(blockId, pin, v) {
      pinWrites.push({ blockId: Number(blockId), pin: Number(pin), v: Number(v) });
    },
    cos: Math.cos,
    sin: Math.sin,
    tan: Math.tan,
    random: () => 0,
    now: () => nowMs,
  };

  diagram(ec);

  return {
    pinWrites,
    intervals,
    setNow(ms: bigint) {
      nowMs = ms;
    },
    tick() {
      for (const interval of intervals.values()) {
        interval.callback();
      }
    },
    close() {
      for (const handler of [...closeHandlers]) {
        handler();
      }
    },
    sendGpioIn(pinIndex: number, value: boolean) {
      worker.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: "gpio_in", blockId: 3, pinIndex, value },
        }),
      );
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diagram", () => {
  test("wires constant and ramp through product, cos, and scope", () => {
    const harness = createDiagram();

    expect([...harness.intervals.values()].map((interval) => interval.period)).toEqual([
      10, 10, 10,
    ]);

    harness.tick();
    harness.pinWrites.length = 0;
    harness.tick();

    expect(harness.pinWrites).toEqual([
      { blockId: 0, pin: 0, v: 1 },
      { blockId: 0, pin: 1, v: Number.NaN },
      { blockId: 0, pin: 2, v: 1 },
      { blockId: 1, pin: 0, v: 1 },
      { blockId: 4, pin: 0, v: 1 },
    ]);
  });

  test("gpio input updates product and scope", () => {
    const harness = createDiagram();
    harness.tick();
    harness.pinWrites.length = 0;

    harness.sendGpioIn(0, false);

    expect(harness.pinWrites).toEqual([{ blockId: 1, pin: 1, v: 0 }]);

    harness.pinWrites.length = 0;
    harness.tick();

    expect(harness.pinWrites.filter((write) => write.blockId === 0)).toEqual([
      { blockId: 0, pin: 0, v: 0 },
      { blockId: 0, pin: 1, v: 0 },
      { blockId: 0, pin: 2, v: 1 },
    ]);
  });

  test("ramp timestamp is converted to seconds before cosine", () => {
    const harness = createDiagram();
    harness.setNow(1000n);
    harness.tick();

    const cosWrite = harness.pinWrites.find((write) => write.blockId === 4);
    expect(cosWrite?.v).toBeCloseTo(Math.cos(1));
  });

  test("onClose clears timers and gpio listener", () => {
    const harness = createDiagram();
    harness.close();

    expect(harness.intervals.size).toBe(0);

    harness.pinWrites.length = 0;
    harness.sendGpioIn(0, true);
    expect(harness.pinWrites).toEqual([]);
  });
});
