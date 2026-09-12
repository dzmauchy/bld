import { expect, test } from "vitest";
import { compileBrowserProgram } from "core/wasm";
import { instantiateWasm } from "core/wasm/run.ts";

test("UI compiles a wasm program and instantiates it", async () => {
  const wasm = compileBrowserProgram({
    blocks: [
      { id: 0, ref: "scope_f32", conf: { precision: 10, period: 60 }, consumers: [], receiveChannels: 1 },
      { id: 1, ref: "const_f32", conf: { precision: 10, v: 1 }, consumers: [{ blockId: 0, channel: 0 }], receiveChannels: 1 },
    ],
  });
  const instance = await instantiateWasm(wasm);
  expect(typeof instance.exports.tick).toBe("function");
  (instance.exports.tick as () => void)();
}, 30_000);
