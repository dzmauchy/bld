import { expect, test } from "@playwright/test";

test("renders App", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toContainText("4");
  await expect(page.locator("#root")).toContainText("basic.ts Basic types");
  await expect(page.locator("#root")).toContainText("diagram.ts Diagram 1");
  await expect(page.locator("#root")).toContainText("push.ts Push stream");
});

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of ["blocks", "namespaces", "types"]) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
