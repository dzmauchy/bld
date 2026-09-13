import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoreSchemaCatalog } from "core";

const distSchemas = join(dirname(fileURLToPath(import.meta.url)), "../dist/schemas");

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

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
