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

test("scope apply without Apply functor", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
  const bytes = await page.evaluate(
    async (sourceFiles) => window.cpp.compileOnly(sourceFiles),
    sources([
      "auto* s = new push::f32::sinks::ScopeF32(0u, 60u, 10u);",
      "auto s_in = s->apply(static_cast<u8>(1));",
      "(void)s_in;",
    ].join("\n")),
  );
  expect(bytes).toBeGreaterThan(0);
  await page.close();
});
