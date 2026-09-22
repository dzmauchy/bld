import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoreSchemaCatalog } from "core";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const distSchemas = join(distDir, "schemas");

function collect(dir: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

test("renders App", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toContainText("4");
  await expect(page.locator("#root")).toContainText("diagram.ts Diagram");
  await expect(page.locator("#root")).toContainText("palette.ts Palette");
  await expect(page.locator("#root")).toContainText("compiler.ts Diagram Compiler");
});

test("copies all JSON schemas into ui/dist/schemas", () => {
  expect(readdirSync(distSchemas).sort()).toEqual(CoreSchemaCatalog.shared.publishedFiles());
});

test("client bundle loads tree-sitter from wasm assets", () => {
  const scripts = collect(distDir, ".js")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  expect(scripts).toContain("locateFile");
  expect(scripts).not.toContain("tree-sitter-cpp/package.json");
  expect(scripts).not.toContain("createRequire");
  expect(collect(distDir, ".wasm").length).toBeGreaterThanOrEqual(2);
});

test("serves tree-sitter wasm assets", async ({ request }) => {
  const wasmFiles = collect(distDir, ".wasm").map((path) => path.slice(distDir.length).split("\\").join("/"));
  expect(wasmFiles.length).toBeGreaterThanOrEqual(2);
  for (const file of wasmFiles) {
    const response = await request.get(file);
    expect(response.ok(), file).toBeTruthy();
    const body = Buffer.from(await response.body());
    expect(body.subarray(0, 4).toString("utf8"), file).toBe("\0asm");
  }
});

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
