import { expect, test } from "@rstest/core";
import { DefaultWasmBindings } from "../../src/bindings.ts";

async function importingModule(namespace: string, name: string, type: number[]): Promise<WebAssembly.Module> {
  const moduleBytes = new TextEncoder().encode(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const importSection = [1, moduleBytes.length, ...moduleBytes, nameBytes.length, ...nameBytes, ...type];
  return WebAssembly.compile(new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 5, 1, 96, 1, 127, 0,
    2, importSection.length, ...importSection,
  ]));
}

test("rejects legacy WASI imports instead of synthesizing no-op functions", async () => {
  const module = await importingModule("wasi_snapshot_preview1", "proc_exit", [0, 0]);
  expect(() => new DefaultWasmBindings().fill(module)).toThrow(
    "unsupported wasm import module wasi_snapshot_preview1",
  );
});

for (const [kind, type] of [
  ["function", [0, 0]],
  ["table", [1, 112, 0, 1]],
  ["memory", [2, 0, 1]],
  ["global", [3, 127, 1]],
] as const) {
  test(`rejects unknown env ${kind} imports without fabricating bindings`, async () => {
    const module = await importingModule("env", "missing", [...type]);
    expect(() => new DefaultWasmBindings().fill(module)).toThrow(
      `unsupported wasm import env.missing (${kind})`,
    );
  });
}

test("does not accept inherited properties as registered host bindings", async () => {
  const module = await importingModule("env", "toString", [0, 0]);
  expect(() => new DefaultWasmBindings().fill(module)).toThrow(
    "unsupported wasm import env.toString (function)",
  );
});
