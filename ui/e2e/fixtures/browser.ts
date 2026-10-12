export { expect, element, dialog, baseURL, fetchAsset, artifactPath, type BrowserElement, type Page } from "../../../tests/e2e/browser.ts";
import { browserTest, expect, element, type Page } from "../../../tests/e2e/browser.ts";
export const test = browserTest();
export const stockTest = browserTest(true);

/** Open the current palette through the same toolbar control users use. */
export async function openPalette(page: Page): Promise<void> {
  const toggle = element(page, "[data-palette-toggle]");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect.poll(() => element(page, "[data-region=palette]").visible()).toBe(true);
}

export async function closePalette(page: Page): Promise<void> {
  const toggle = element(page, "[data-palette-toggle]");
  if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  await expect.poll(() => element(page, "[data-region=palette]").visible()).toBe(false);
}
