import { expect, test } from "vitest";
import { createBrowserWasmRuntime } from "../../src/wasm/runtime.ts";

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserWasmRuntime).toBeTypeOf("function");
});
