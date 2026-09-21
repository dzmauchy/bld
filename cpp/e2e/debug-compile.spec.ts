import { expect, test, type Page } from "@playwright/test";
import { nativeLibraryFiles } from "../../base/src/index.ts";
import type { CppPageApi } from "../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

const files = nativeLibraryFiles();

test("compiles the native host as a single translation unit", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
  const bytes = await page.evaluate(async (sourceFiles) => window.cpp.compile(sourceFiles), {
    "bld.hpp": files["bld.hpp"] ?? "",
    "base.hpp": files["base.hpp"] ?? "",
    "wasm_host.hpp": files["wasm_host.hpp"] ?? "",
    "wasm_host.inc": files["wasm_host.cpp"] ?? "",
    "diagram.cpp": [
      "#include <base.hpp>",
      "#include \"wasm_host.hpp\"",
      "#include \"wasm_host.inc\"",
      "extern \"C\" void build_diagram() {}",
    ].join("\n"),
  });
  expect(bytes).toBeGreaterThan(0);
  const started = await page.evaluate(async () => window.cpp.invoke("activeIntervalCount", []));
  expect(started).toBe(0);
  await page.close();
});
