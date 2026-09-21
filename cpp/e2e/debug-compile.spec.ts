import { expect, test } from "@playwright/test";
import { nativeLibraryFiles } from "../../base/src/index.ts";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  PortEndpoint,
  registerAppAssets,
} from "../../core/src/index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CppPageApi } from "../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
registerAppAssets({
  "base.json": readFileSync(join(here, "../../core/assets/base.json"), "utf8"),
  "blocks.json": readFileSync(join(here, "../../core/assets/blocks.json"), "utf8"),
  "types.json": readFileSync(join(here, "../../core/assets/types.json"), "utf8"),
  "namespaces.json": readFileSync(join(here, "../../core/assets/namespaces.json"), "utf8"),
});

const builder = new CppDiagramBuilder(nativeLibraryFiles());

test("compiles and runs const-to-scope without braced apply", async ({ browser }) => {
  const palette = (await Library.load("base.json")).palette;
  const diagram = new Diagram("const_scope", "const_scope", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
  diagram.connect(new PortEndpoint("c", "input", "v", 0), new PortEndpoint("s", "output", "sink", 0));
  const files = Object.fromEntries(builder.build(diagram));
  expect(files["diagram.cpp"]).toContain("c_dn.push_back(s_in[0])");

  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
  await page.evaluate(async (sourceFiles) => window.cpp.compile(sourceFiles), files);
  expect(await page.evaluate(async () => window.cpp.invoke("lastPin", [0, 0]))).toBe(3.5);
  expect(await page.evaluate(async () => window.cpp.invoke("hasPin", [0, 0]))).toBe(1);
  await page.close();
});
