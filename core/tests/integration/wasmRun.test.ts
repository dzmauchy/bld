import { expect, test } from "@rstest/core";
import { toWasmBytes } from "cpp/wasmBytes.ts";
import { instantiateWasm } from "../../src/runtime/run.ts";

// A module exporting memory and bump(), backed by a mutable counter starting at zero.
const counterModule = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
  5, 3, 1, 0, 1, 6, 6, 1, 127, 1, 65, 0, 11, 7, 17, 2, 6, 109, 101,
  109, 111, 114, 121, 2, 0, 4, 98, 117, 109, 112, 0, 0, 10, 13, 1, 11,
  0, 35, 0, 65, 1, 106, 36, 0, 35, 0, 11,
]);

test("instantiates bounded wasm views without a second copy and resets program state for each run", async () => {
  const padded = new Uint8Array(counterModule.byteLength + 16);
  padded.set(counterModule, 8);
  const wasm = padded.subarray(8, 8 + counterModule.byteLength);
  const view = toWasmBytes(wasm);
  expect(view.buffer).toBe(wasm.buffer);
  expect(view.byteOffset).toBe(8);
  expect(view.byteLength).toBe(counterModule.byteLength);
  const first = await instantiateWasm(wasm);
  const bump = first.exports.bump as () => number;
  expect(bump()).toBe(1);
  expect(bump()).toBe(2);
  const second = await instantiateWasm(wasm);
  expect((second.exports.bump as () => number)()).toBe(1);
  expect(wasm).toEqual(counterModule);
});
