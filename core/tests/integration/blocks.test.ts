import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserCompiler, Diagram, Library, PortEndpoint } from "../../src";
import { compileBrowserProgram } from "runtime";
import { createNodeWasmRuntime } from "runtime/runtime.node.ts";
import type { WasmSession } from "runtime/runtime.ts";

const runtime = createNodeWasmRuntime();
const compiler = new BrowserCompiler();

beforeAll(async () => {
  await Library.load("base.json");
});

afterAll(async () => {
  await runtime.close();
});

function connect(diagram: Diagram, fromId: string, fromPort: string, fromVec: number, toId: string, toPort: string, toVec: number): void {
  const fromBlock = diagram.getBlock(fromId);
  const toBlock = diagram.getBlock(toId);
  if (!fromBlock || !toBlock) throw new Error("missing block");
  const fromType = fromBlock.definition.getOutput(fromPort) ? "output" : "input";
  const toType = toBlock.definition.getOutput(toPort) ? "output" : "input";
  diagram.connect(
    new PortEndpoint(fromId, fromType, fromPort, fromVec),
    new PortEndpoint(toId, toType, toPort, toVec),
  );
}

async function run(build: (diagram: Diagram) => void): Promise<WasmSession> {
  const diagram = new Diagram("blocks", "blocks");
  build(diagram);
  return diagram.run(runtime, compiler);
}

describe("generated wasm pin programs", () => {
  test("const_f32 pushes value to scope", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
      connect(d, "c", "v", 0, "s", "sink", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(3.5);
  });

  test("const_f32 fans out to two scope channels", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 8 });
      connect(d, "c", "v", 0, "s", "sink", 0);
      connect(d, "c", "v", 0, "s", "sink", 1);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(8);
    expect(await session.lastPin(0, 1)).toBe(8);
  });

  test("const_f32 default precision is ten", async () => {
    const session = await run((d) => {
      d.addBlock("const_f32", { x: 0, y: 0 }, "c");
    });
    expect(await session.intervalPeriodAt(0)).toBe(10);
  });

  test("const_f32 uses configured precision", async () => {
    const session = await run((d) => {
      d.addBlock("const_f32", { x: 0, y: 0 }, "c", { precision: 25, v: 1 });
    });
    expect(await session.intervalPeriodAt(0)).toBe(25);
  });

  test("const_f32 on close stops pushing", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 9 });
      connect(d, "c", "v", 0, "s", "sink", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(9);
    await session.close();
    expect(await session.activeIntervalCount()).toBe(0);
    await session.clearPins();
    await session.tick();
    expect(await session.hasPin(0, 0)).toBe(false);
  });

  test("product_f32 two constants", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
      d.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
      connect(d, "p", "p", 0, "s", "sink", 0);
      connect(d, "a", "v", 0, "p", "v", 0);
      connect(d, "b", "v", 0, "p", "v", 1);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(12);
    expect(await session.lastPin(1, 0)).toBe(3);
    expect(await session.lastPin(1, 1)).toBe(4);
  });

  test("product_f32 unset factor defaults to one", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 6 });
      connect(d, "p", "p", 0, "s", "sink", 0);
      connect(d, "a", "v", 0, "p", "v", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(6);
    expect(await session.lastPin(1, 0)).toBe(6);
  });

  test("cos_f32 of zero is one", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("cos_f32", { x: 1, y: 0 }, "cos");
      d.addBlock("const_f32", { x: 2, y: 0 }, "c", { v: 0 });
      connect(d, "cos", "cos", 0, "s", "sink", 0);
      connect(d, "c", "v", 0, "cos", "v", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(1);
    expect(await session.lastPin(1, 0)).toBe(1);
  });

  test("sin_f32 of zero is zero", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sin_f32", { x: 1, y: 0 }, "sin");
      d.addBlock("const_f32", { x: 2, y: 0 }, "c", { v: 0 });
      connect(d, "sin", "sin", 0, "s", "sink", 0);
      connect(d, "c", "v", 0, "sin", "v", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(0);
    expect(await session.lastPin(1, 0)).toBe(0);
  });

  test("scope_f32 reports nan before any push", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
    });
    await session.tick();
    expect(Number.isNaN(await session.lastPin(0, 0))).toBe(true);
  });

  test("scope_f32 channels are independent", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "a", { v: 1.5 });
      d.addBlock("const_f32", { x: 2, y: 0 }, "b", { v: 9.5 });
      connect(d, "a", "v", 0, "s", "sink", 0);
      connect(d, "b", "v", 0, "s", "sink", 1);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(1.5);
    expect(await session.lastPin(0, 1)).toBe(9.5);
  });

  test("cos_gen_f32 at zero is one", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("cos_gen_f32", { x: 1, y: 0 }, "g");
      connect(d, "g", "v", 0, "s", "sink", 0);
    });
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(1);
  });

  test("sin_gen_f32 at one second", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sin_gen_f32", { x: 1, y: 0 }, "g");
      connect(d, "g", "v", 0, "s", "sink", 0);
    });
    await session.setNow(1000);
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBeCloseTo(Math.sin(1), 5);
  });

  test("rand_gen_f32 uses setRandom", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("rand_gen_f32", { x: 1, y: 0 }, "g");
      connect(d, "g", "v", 0, "s", "sink", 0);
    });
    await session.setRandom(0.25);
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(0.25);
  });

  test("pulse_gen high at start of period", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("pulse_gen_f32", { x: 1, y: 0 }, "g", { period: 10, duty_cycle: 0.5 });
      connect(d, "g", "v", 0, "s", "sink", 0);
    });
    await session.setNow(0);
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(1);
  });

  test("pulse_gen low after duty window", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("pulse_gen_f32", { x: 1, y: 0 }, "g", { period: 10, duty_cycle: 0.5 });
      connect(d, "g", "v", 0, "s", "sink", 0);
    });
    await session.setNow(5);
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(0);
  });

  test("gpio_in true is one on scope", async () => {
    const wasm = compileBrowserProgram({
      blocks: [
        { id: 0, ref: "scope_f32", conf: {}, consumers: [], receiveChannels: 1 },
        {
          id: 1,
          ref: "gpio_in",
          conf: { pins: [0] },
          consumers: [{ blockId: 0, channel: 0 }],
          pinConsumers: [[{ blockId: 0, channel: 0 }]],
          receiveChannels: 1,
        },
      ],
    });
    const session = await runtime.instantiate(wasm);
    await session.emitGpioIn(1, 0, true);
    await session.tickThenObserve();
    expect(await session.lastPin(0, 0)).toBe(1);
  });

  test("gpio_in ignores other block ids", async () => {
    const wasm = compileBrowserProgram({
      blocks: [
        { id: 0, ref: "scope_f32", conf: {}, consumers: [], receiveChannels: 1 },
        {
          id: 1,
          ref: "gpio_in",
          conf: { pins: [0] },
          consumers: [{ blockId: 0, channel: 0 }],
          pinConsumers: [[{ blockId: 0, channel: 0 }]],
          receiveChannels: 1,
        },
      ],
    });
    const session = await runtime.instantiate(wasm);
    await session.emitGpioIn(99, 0, true);
    await session.tick();
    expect(Number.isNaN(await session.lastPin(0, 0))).toBe(true);
  });

  test("gpio_in on close stops listening", async () => {
    const wasm = compileBrowserProgram({
      blocks: [
        { id: 0, ref: "scope_f32", conf: {}, consumers: [], receiveChannels: 1 },
        {
          id: 1,
          ref: "gpio_in",
          conf: { pins: [0] },
          consumers: [{ blockId: 0, channel: 0 }],
          pinConsumers: [[{ blockId: 0, channel: 0 }]],
          receiveChannels: 1,
        },
      ],
    });
    const session = await runtime.instantiate(wasm);
    await session.close();
    expect(await session.activeGpioListenerCount()).toBe(0);
    await session.emitGpioIn(1, 0, true);
    await session.clearPins();
    await session.tick();
    expect(await session.hasPin(0, 0)).toBe(false);
  });

  test("demo diagram cos times sin at one second", async () => {
    const session = await run((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("cos_gen_f32", { x: 2, y: 0 }, "c");
      d.addBlock("sin_gen_f32", { x: 3, y: 0 }, "n");
      connect(d, "p", "p", 0, "s", "sink", 0);
      connect(d, "c", "v", 0, "p", "v", 0);
      connect(d, "n", "v", 0, "p", "v", 1);
    });
    await session.setNow(1000);
    await session.tickThenObserve();
    expect(await session.lastPin(1, 0)).toBeCloseTo(Math.cos(1), 5);
    expect(await session.lastPin(1, 1)).toBeCloseTo(Math.sin(1), 5);
    expect(await session.lastPin(0, 0)).toBeCloseTo(Math.cos(1) * Math.sin(1), 5);
  });
});
