import { expect, test } from "@rstest/core";
import { createBrowserWasmRuntime } from "../../src/wasm/runtime.ts";

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserWasmRuntime).toBeTypeOf("function");
});
