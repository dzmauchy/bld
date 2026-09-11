import { describe, expect, test } from "vitest";
import { compileAssembly } from "./compile.ts";
import { createWasmImports, defaultEnvBindings, instantiateWasm } from "./run.ts";

describe("assemblyscript compile and host bindings", () => {
  test("compiles a program that calls a UI-provided env import", async () => {
    const wasm = await compileAssembly(
      `
@external("env", "sendPinF32")
declare function sendPinF32(blockId: i32, pin: i32, value: f32): void;

export function ping(): void {
  sendPinF32(7, 1, 3.5);
}
`,
      {},
    );
    const calls: number[] = [];
    const instance = await instantiateWasm(
      wasm,
      createWasmImports({
        ...defaultEnvBindings(),
        sendPinF32(blockId: number, pin: number, value: number) {
          calls.push(blockId, pin, value);
        },
      }),
    );
    const ping = instance.exports.ping;
    expect(typeof ping).toBe("function");
    (ping as () => void)();
    expect(calls).toEqual([7, 1, 3.5]);
  });
});
