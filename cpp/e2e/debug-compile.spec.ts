import { expect, test } from "@playwright/test";
import { nativeLibraryFiles } from "../../base/src/index.ts";
import type { CppPageApi } from "../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

const native = nativeLibraryFiles();

function sources(body: string): Record<string, string> {
  return {
    "bld.hpp": native["bld.hpp"] ?? "",
    "base.hpp": native["base.hpp"] ?? "",
    "wasm_host.hpp": native["wasm_host.hpp"] ?? "",
    "wasm_host.inc": native["wasm_host.cpp"] ?? "",
    "diagram.cpp": [
      "#include <base.hpp>",
      "#include \"wasm_host.hpp\"",
      "#include \"wasm_host.inc\"",
      "extern \"C\" void build_diagram() {",
      body,
      "}",
    ].join("\n"),
  };
}

test("gpio connectPin and apply", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
  const bytes = await page.evaluate(
    async (sourceFiles) => window.cpp.compile(sourceFiles),
    sources(
      [
        "auto* s = new push::f32::sinks::ScopeF32(0u, 60u, 10u);",
        "auto pins = Array<u8>{};",
        "pins.push_back(0);",
        "auto* g = new push::f32::sources::GpioInF32(1u, 0, static_cast<Array<u8>&&>(pins));",
        "auto s_in = s->apply(static_cast<u8>(1));",
        "auto g_p0 = VectorizedInput<Pss<f32>>{};",
        "g_p0.push_back(s_in[0]);",
        "g->connectPin(static_cast<u8>(0), static_cast<VectorizedInput<Pss<f32>>&&>(g_p0));",
        "g->apply();",
        "auto hw = Array<u8>{};",
        "hw.push_back(0);",
        "register_gpio_block(1u, 0, hw);",
      ].join("\n"),
    ),
  );
  expect(bytes).toBeGreaterThan(0);
  await page.evaluate(async () => window.cpp.invoke("emitGpioIn", [1, 0, 1]));
  expect(await page.evaluate(async () => window.cpp.invoke("lastPin", [0, 0]))).toBe(1);
  await page.close();
});
