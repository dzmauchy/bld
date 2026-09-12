import { expect, test } from "@playwright/test";

test("renders App", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toContainText("4");
  await expect(page.locator("#root")).toContainText("diagram.ts Diagram");
  await expect(page.locator("#root")).toContainText("palette.ts Palette");
  await expect(page.locator("#root")).toContainText("compiler.ts Diagram Compiler");
});

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of ["blocks", "namespaces", "types"]) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
