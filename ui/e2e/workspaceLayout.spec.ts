import { openPalette, expect, test, element, baseURL, artifactPath } from "./fixtures/browser.ts";

test("shows SVG toolbar controls and changes palette visibility only with its toggle", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const palette = element(page, "[data-region=palette]");
  const toggle = element(page, "[data-palette-toggle]");
  await expect.poll(() => palette.visible()).toBe(false);
  expect(await toggle.getAttribute("aria-expanded")).toBe("false");
  const controls = await element(page, "[data-toolbar] button").evaluateAll((buttons) => buttons.map((button) => ({
    text: button.textContent?.trim(),
    icons: button.querySelectorAll("svg").length,
    tooltip: button.getAttribute("title"),
    label: button.getAttribute("aria-label"),
  })));
  expect(controls).toHaveLength(3);
  for (const control of controls) {
    expect(control.text).toBe("");
    expect(control.icons).toBe(1);
    expect(control.tooltip).toBeTruthy();
    expect(control.label).toBeTruthy();
  }
  await openPalette(page);
  await palette.within("[data-block-id=ConstF32]").click();
  await expect.poll(() => palette.visible()).toBe(true);
  expect(await toggle.getAttribute("aria-expanded")).toBe("true");
  const canvas = element(page, "[data-diagram-canvas]");
  await expect.poll(() => canvas.getAttribute("data-armed")).toBe("ConstF32");
  await canvas.click({ position: { x: 280, y: 160 } });
  await expect.poll(() => canvas.within("[data-block-ref=ConstF32]").count()).toBe(1);
  expect(await palette.visible()).toBe(true);
  await page.keyboard.press("Escape");
  expect(await palette.visible()).toBe(true);
  await toggle.click();
  await expect.poll(() => palette.visible()).toBe(false);
  await toggle.click();
  await expect.poll(() => palette.visible()).toBe(true);
  await toggle.click();
  await expect.poll(() => palette.visible()).toBe(false);
  await page.screenshot({ path: artifactPath("desktop-toolbar.png") });
});

test("places the landscape phone toolbar on the left with its icons at the bottom", async ({ page }) => {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const toolbar = element(page, "[data-toolbar]");
  const portrait = await toolbar.boundingBox();
  expect(portrait!.y).toBe(0);
  expect(portrait!.width).toBe(390);
  expect(portrait!.height).toBe(48);

  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await expect.poll(() => toolbar.evaluate((bar) => getComputedStyle(bar).flexDirection)).toBe("column");
  const landscape = await toolbar.boundingBox();
  expect(landscape!.x).toBe(0);
  expect(landscape!.y).toBe(0);
  expect(landscape!.width).toBe(48);
  expect(landscape!.height).toBe(390);
  const buttons = await toolbar.within("button").evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { x: box.left, y: box.top, bottom: box.bottom, width: box.width, height: box.height };
  }));
  expect(buttons[0].y).toBeGreaterThan(200);
  expect(buttons.at(-1)!.bottom).toBe(384);
  for (const button of buttons) {
    expect(button.x).toBeGreaterThanOrEqual(landscape!.x);
    expect(button.x + button.width).toBeLessThanOrEqual(landscape!.x + landscape!.width);
    expect(button.width).toBe(44);
    expect(button.height).toBe(44);
  }
  const canvas = element(page, "[data-diagram-canvas]");
  expect((await canvas.boundingBox())!.x).toBe(48);
  await openPalette(page);
  const palette = element(page, "[data-region=palette]");
  expect((await palette.boundingBox())!.x).toBe(48);
  await palette.within("[data-block-id=ConstF32]").click();
  await expect.poll(() => palette.visible()).toBe(true);
  await canvas.click({ position: { x: 200, y: 140 } });
  await expect.poll(() => canvas.within("[data-block-ref=ConstF32]").count()).toBe(1);
  expect(await palette.visible()).toBe(true);
  await element(page, "[data-palette-toggle]").click();
  await expect.poll(() => palette.visible()).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBe(0);
  await page.screenshot({ path: artifactPath("landscape-phone-toolbar.png") });
});

test("keeps the desktop workspace inside the viewport while panels scroll", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await openPalette(page);
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
