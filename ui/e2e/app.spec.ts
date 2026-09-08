import { expect, test } from "@playwright/test";

test("renders App", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toHaveText("4");
});
