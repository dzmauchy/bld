import { expect, test } from "vitest";
import { createBrowserWasmRuntime } from "ui/wasm/runtime.ts";

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserWasmRuntime).toBeTypeOf("function");
});
