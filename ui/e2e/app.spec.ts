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

test("client bundle has no C++ parser wasm assets", () => {
  const scripts = collect(distDir, ".js")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  expect(scripts).not.toContain("tree-sitter");
  expect(scripts).not.toContain("TreeSitter");
  expect(collect(distDir, ".wasm")).toHaveLength(0);
});

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
