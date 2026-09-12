import { describe, expect, test } from "vitest";
import { BrowserCompiler, Diagram, Library, PortEndpoint } from "../../../src";
import { instantiateWasm, defaultEnvBindings } from "../../../src/wasm/run.ts";

describe("binaryen compile and host bindings", () => {
  test("compiled diagram calls sendPinF32", async () => {
    await Library.load("base.json");
    const diagram = new Diagram("pin", "pin");
    const scope = diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
    const constant = diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
    diagram.connect(
      new PortEndpoint(constant.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    const wasm = new BrowserCompiler().compile(diagram);
    const calls: number[] = [];
    const instance = await instantiateWasm(wasm, {
      ...defaultEnvBindings(),
      sendPinF32(blockId: number, pin: number, value: number) {
        calls.push(blockId, pin, value);
      },
    });
    const tickThenObserve = instance.exports.tickThenObserve;
    expect(typeof tickThenObserve).toBe("function");
    (tickThenObserve as () => void)();
    expect(calls).toContain(3.5);
  });
});
