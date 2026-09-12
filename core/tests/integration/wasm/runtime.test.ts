import { expect, test } from "vitest";
import { BrowserCompiler, Diagram, Library, PortEndpoint } from "../../../src";
import { WasmRuntime } from "../../../src/wasm/runtime.ts";
import { nodeThread } from "../../../src/wasm/runtime.node.ts";

test("run worker forwards UI env bindings to the host thread", async () => {
  await Library.load("base.json");
  const pins: unknown[] = [];
  const runtime = new WasmRuntime({
    runThread: nodeThread("host.run.worker.ts"),
    onHostMessage(message) {
      pins.push(message);
    },
  });
  try {
    const diagram = new Diagram("pin", "pin");
    const scope = diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
    const constant = diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
    diagram.connect(
      new PortEndpoint(constant.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    const session = await diagram.run(runtime, new BrowserCompiler());
    await session.tickThenObserve();
    expect(pins.some((message) => (message as { value?: number }).value === 3.5)).toBe(true);
  } finally {
    await runtime.close();
  }
}, 30_000);
