import { expect, test } from "@playwright/test";

test("renders App", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#root")).toContainText("4");
  await expect(page.locator("#root")).toContainText("basic.ts Basic types");
  await expect(page.locator("#root")).toContainText("diagram.ts Diagram 1");
  await expect(page.locator("#root")).toContainText("push.ts Push stream");
});
