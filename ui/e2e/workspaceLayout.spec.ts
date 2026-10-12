import { expect, test, element, baseURL } from "./fixtures/browser.ts";

test("keeps the desktop workspace inside the viewport while panels scroll", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await expect.poll(() => element(page, "[data-region=palette] [data-block-id]").count()).toBe(22);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
    { width: 1366, height: 600 },
  ]) {
    await page.setViewport(viewport);
    await expect.poll(async () => page.evaluate(() => {
      const documentRoot = document.documentElement;
      const palette = document.querySelector("[data-region=palette]")!.getBoundingClientRect();
      const diagram = document.querySelector("[data-region=diagram]")!.getBoundingClientRect();
      return {
        documentOverflow: documentRoot.scrollHeight - documentRoot.clientHeight,
        paletteBottom: Math.round(palette.bottom - window.innerHeight),
        diagramBottom: Math.round(diagram.bottom - window.innerHeight),
      };
    }), { timeout: 5_000 }).toEqual({ documentOverflow: 0, paletteBottom: 0, diagramBottom: 0 });
  }

  const paletteList = element(page, ".palette-list");
  expect(await paletteList.evaluate((list) => list.scrollHeight - list.clientHeight)).toBeGreaterThan(0);
  const bounds = await paletteList.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel({ deltaY: 400 });
  await expect.poll(() => paletteList.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
