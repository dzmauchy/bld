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

async function compileOnly(browser: import("@playwright/test").Browser, body: string): Promise<number> {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
  const bytes = await page.evaluate(async (sourceFiles) => window.cpp.compileOnly(sourceFiles), sources(body));
  await page.close();
  return bytes;
}

const ctor = [
  "auto* s = new push::f32::sinks::ScopeF32(0u, 60u, 10u);",
  "auto pins = Array<u8>{};",
  "pins.push_back(0);",
  "auto* g = new push::f32::sources::GpioInF32(1u, 0, static_cast<Array<u8>&&>(pins));",
  "auto s_in = s->apply(static_cast<u8>(1));",
].join("\n");

test("gpio connectPin only", async ({ browser }) => {
  expect(
    await compileOnly(
      browser,
      [
        ctor,
        "auto g_p0 = VectorizedInput<Pss<f32>>{};",
        "g_p0.push_back(s_in[0]);",
        "g->connectPin(static_cast<u8>(0), static_cast<VectorizedInput<Pss<f32>>&&>(g_p0));",
      ].join("\n"),
    ),
  ).toBeGreaterThan(0);
});

test("gpio apply only", async ({ browser }) => {
  expect(await compileOnly(browser, `${ctor}\ng->apply();`)).toBeGreaterThan(0);
});
