import { closePalette, openPalette, expect, test, element, baseURL, type Page } from "./fixtures/browser.ts";

async function insert(page: Page, ref: string, x: number, y: number): Promise<void> {
  await openPalette(page);
  const button = element(page, `[data-region=palette] [data-block-id=${ref}]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await closePalette(page);
  await element(page, "[data-diagram-canvas]").click({ position: { x, y } });
}

async function expectPortsOnGrid(page: Page): Promise<void> {
  const anchors = await element(page, "[data-diagram-canvas]").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return [...canvas.querySelectorAll("[data-port-id]")].flatMap((port) => {
      const pins = [...port.querySelectorAll("[data-port-pin]")];
      return [port, ...pins].map((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2 - bounds.left + canvas.scrollLeft,
          y: rect.top + rect.height / 2 - bounds.top + canvas.scrollTop,
        };
      });
    });
  });
  expect(anchors.length).toBeGreaterThan(0);
  for (const anchor of anchors) {
    expect(anchor.x / 10).toBeCloseTo(Math.round(anchor.x / 10), 5);
    expect(anchor.y / 10).toBeCloseTo(Math.round(anchor.y / 10), 5);
  }
}

test("snaps block placement and each drag update to the nearest 10px grid point", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await insert(page, "ConstF32", 243, 157);
  const block = element(page, "[data-block-ref=ConstF32]");
  const position = () => block.evaluate((node) => ({ x: (node as HTMLElement).style.left, y: (node as HTMLElement).style.top }));
  await expect.poll(position).toEqual({ x: "200px", y: "120px" });
  await expectPortsOnGrid(page);
  const box = (await block.boundingBox())!;
  expect(box.height).toBe(80);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 17, y + 23);
  await expect.poll(position).toEqual({ x: "220px", y: "140px" });
  await expectPortsOnGrid(page);
  await page.mouse.move(x + 24, y + 16);
  await expect.poll(position).toEqual({ x: "220px", y: "140px" });
  await page.mouse.move(x + 26, y + 14);
  await expect.poll(position).toEqual({ x: "230px", y: "130px" });
  await page.mouse.up();
  await expectPortsOnGrid(page);
});

test("keeps placement and ports snapped in canvas coordinates after scrolling", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await insert(page, "ConstF32", 233, 650);
  await page.setViewport({ width: 1280, height: 400 });
  const canvas = element(page, "[data-diagram-canvas]");
  await canvas.evaluate((node) => { node.scrollTop = 177; });
  expect(await canvas.evaluate((node) => node.scrollTop)).toBe(177);
  await insert(page, "SinF32", 233, 157);
  await expect.poll(() => element(page, "[data-block-ref=SinF32]").evaluate((node) => ({
    x: (node as HTMLElement).style.left, y: (node as HTMLElement).style.top,
  }))).toEqual({ x: "210px", y: "290px" });
  await expectPortsOnGrid(page);
});
