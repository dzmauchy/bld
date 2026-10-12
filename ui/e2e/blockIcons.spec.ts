import { readdirSync } from "node:fs";
import { closePalette, openPalette, expect, test, element, baseURL, fetchAsset, artifactPath } from "./fixtures/browser.ts";


test("every block SVG has centered artwork and padding inside its viewport", async ({ page }) => {
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const names = readdirSync(new URL("../public/icons/", import.meta.url))
    .filter((name) => name.endsWith(".svg") && !["bld.svg", "bigbld.svg"].includes(name));
  for (const name of names) {
    const response = await fetchAsset(`/icons/${name}`);
    expect(response.ok, name).toBe(true);
    const svg = await response.text();
    const geometry = await page.evaluate((markup) => {
      const slot = document.createElement("span");
      slot.className = "diagram-block-icon";
      slot.innerHTML = markup;
      document.body.appendChild(slot);
      try {
        const icon = slot.querySelector("svg")!;
        const view = icon.viewBox.baseVal;
        const bounds = icon.getBBox();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
          viewWidth: view.width, viewHeight: view.height };
      } finally { slot.remove(); }
    }, svg);
    expect(geometry.viewWidth, name).toBe(24);
    expect(geometry.viewHeight, name).toBe(24);
    // Includes clearance for the 1.6-unit stroke around the 18-unit artwork.
    expect(geometry.x, name).toBeGreaterThanOrEqual(2.9);
    expect(geometry.y, name).toBeGreaterThanOrEqual(2.9);
    expect(geometry.x + geometry.width, name).toBeLessThanOrEqual(21.1);
    expect(geometry.y + geometry.height, name).toBeLessThanOrEqual(21.1);
    expect(geometry.x + geometry.width / 2, name).toBeCloseTo(12, 3);
    expect(geometry.y + geometry.height / 2, name).toBeCloseTo(12, 3);
  }
});

test("all palette and canvas block icons are centered above their labels without cropping", async ({ page }) => {
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const palette = element(page, "[data-region=palette]");
  const canvas = element(page, "[data-diagram-canvas]");
  const refs = await palette.within("[data-block-id]").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("data-block-id")!));
  for (const [index, ref] of refs.entries()) {
    const button = palette.within(`[data-block-id=${ref}]`);
    await openPalette(page);
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await closePalette(page);
    await canvas.click({ position: { x: 90 + (index % 6) * 200, y: 100 + Math.floor(index / 6) * 160 } });
    await expect.poll(() => canvas.within(`[data-block-ref=${ref}]`).count()).toBe(1);
  }
  await openPalette(page);
  const geometry = await element(page, "[data-block-id], [data-diagram-block]").evaluateAll((blocks) => blocks.map((block) => {
    const svg = block.querySelector(".flow-node-icon svg, .diagram-block-icon svg") as SVGSVGElement;
    const label = block.querySelector(".flow-node-title, .diagram-block-title")!;
    const bounds = block.getBoundingClientRect();
    const icon = svg.getBoundingClientRect();
    const text = label.getBoundingClientRect();
    const artwork = svg.getBBox();
    return { id: block.getAttribute("data-block-id") ?? block.getAttribute("data-diagram-block"),
      centerOffset: icon.x + icon.width / 2 - (bounds.x + bounds.width / 2),
      leftClearance: icon.left - bounds.left, rightClearance: bounds.right - icon.right,
      topClearance: icon.top - bounds.top, labelGap: text.top - icon.bottom,
      artworkCenterX: artwork.x + artwork.width / 2, artworkCenterY: artwork.y + artwork.height / 2,
      background: getComputedStyle(block).backgroundImage };
  }));
  expect(geometry).toHaveLength(refs.length * 2);
  for (const icon of geometry) {
    expect(Math.abs(icon.centerOffset), icon.id!).toBeLessThan(1);
    expect(icon.leftClearance, icon.id!).toBeGreaterThan(0);
    expect(icon.rightClearance, icon.id!).toBeGreaterThan(0);
    expect(icon.topClearance, icon.id!).toBeGreaterThan(0);
    expect(icon.labelGap, icon.id!).toBeGreaterThan(0);
    expect(icon.artworkCenterX, icon.id!).toBeCloseTo(12, 3);
    expect(icon.artworkCenterY, icon.id!).toBeCloseTo(12, 3);
    expect(icon.background, icon.id!).toContain("linear-gradient");
  }
  await page.screenshot({ path: artifactPath("centered-block-icons.png") });
});
