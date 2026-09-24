import { expect, test } from "@playwright/test";

test("loads the base palette in a stock browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect.poll(async () => {
    const failure = page.locator("[data-library-status=error]");
    if (await failure.count()) return `error:${await failure.innerText()}`;
    if (await page.locator("[data-block-id=const_f32]").count()) return "ready";
    return "pending";
  }).toBe("ready");

  await expect(page.locator("[data-splash]")).toBeHidden();
  const palette = page.locator("[data-region=palette]");
  const diagram = page.locator("[data-region=diagram]");
  await expect(palette).toBeVisible();
  await expect(diagram).toBeVisible();
  await palette.locator("[data-block-id=const_f32]").click();
  await expect(diagram.locator("[data-block-ref=const_f32]")).toHaveCount(1);
  expect(errors.join("\n")).not.toMatch(/invalid heap type/i);
});
