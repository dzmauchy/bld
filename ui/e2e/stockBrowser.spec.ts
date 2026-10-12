import { expect, stockTest as test, element, baseURL } from "./fixtures/browser.ts";

test("loads the base palette in a stock browser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error instanceof Error ? error.message : String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(baseURL());
  await expect.poll(async () => {
    const failure = element(page, "[data-library-status=error]");
    if (await failure.count()) return `error:${await failure.text()}`;
    if (await element(page, "[data-block-id=ConstF32]").count()) return "ready";
    return "pending";
  }).toBe("ready");

  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const palette = element(page, "[data-region=palette]");
  const diagram = element(page, "[data-region=diagram]");
  await expect.poll(() => palette.visible()).toBe(true);
  await expect.poll(() => diagram.visible()).toBe(true);
  const constant = palette.within("[data-block-id=ConstF32]");
  await constant.click();
  await expect.poll(() => constant.getAttribute("data-armed")).toBe("true");
  await expect.poll(() => diagram.within("[data-block-ref=ConstF32]").count()).toBe(0);
  await diagram.within("[data-diagram-canvas]").click({ position: { x: 96, y: 80 } });
  await expect.poll(() => diagram.within("[data-block-ref=ConstF32]").count()).toBe(1);
  expect(errors.join("\n")).not.toMatch(/invalid heap type/i);
});
