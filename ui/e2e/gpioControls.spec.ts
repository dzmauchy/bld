import { closePalette, openPalette, expect, test, element, baseURL, artifactPath, type Page } from "./fixtures/browser.ts";

async function insert(page: Page, ref: string, x: number, y: number): Promise<void> {
  await openPalette(page);
  const source = element(page, `[data-region=palette] [data-block-id=${ref}]`);
  await source.scrollIntoViewIfNeeded();
  await source.click();
  await closePalette(page);
  await element(page, "[data-diagram-canvas]").click({ position: { x, y } });
}

test("GPIO pin switches drive the worker, reset between runs, and enable only during a run", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await insert(page, "ScopeF32", 160, 200);
  await insert(page, "GpioInF32", 450, 200);
  const gpio = element(page, "[data-block-ref=GpioInF32]");
  const scope = element(page, "[data-block-ref=ScopeF32]");
  const run = element(page, "[data-run-toggle]");
  const config = gpio.within("[data-block-config]");
  const first = gpio.within("[data-gpio-pin='0']");
  expect(await first.disabled()).toBe(true);
  await config.click();
  const dialog = element(page, "[data-block-config-dialog]");
  await expect.poll(() => dialog.shadow("dialog").visible()).toBe(true);
  const pins = dialog.within("[data-config-field=pins] input");
  await pins.fill("1, 3");
  await pins.press("Tab");
  await page.keyboard.press("Escape");
  await expect.poll(() => dialog.count()).toBe(0);
  const second = gpio.within("[data-gpio-pin='1']");
  await expect.poll(() => second.disabled()).toBe(true);
  expect(await first.getAttribute("aria-label")).toBe("GPIO pin 1");
  expect(await second.getAttribute("aria-label")).toBe("GPIO pin 3");
  for (let index = 0; index < 2; index++) {
    await scope.within("[data-port-side=output]").click();
    await gpio.within("[data-port-side=input]").click();
  }
  await scope.click();
  const plot = element(page, "[data-scope-plot]");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect(await first.disabled()).toBe(false);
  expect(await second.disabled()).toBe(false);
  expect(await config.disabled()).toBe(true);
  expect(await scope.within("[data-block-config]").disabled()).toBe(true);
  await first.click();
  await expect.poll(() => first.getAttribute("aria-checked")).toBe("true");
  await expect.poll(() => plot.getAttribute("data-last")).toBe("1 0");
  await second.click();
  await expect.poll(() => plot.getAttribute("data-last")).toBe("1 1");
  await first.click();
  await expect.poll(() => plot.getAttribute("data-last")).toBe("0 1");
  expect(await run.getAttribute("data-run-state")).toBe("running");
  await page.screenshot({ path: artifactPath("gpio-running.png") });
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  expect(await first.disabled()).toBe(true);
  expect(await second.disabled()).toBe(true);
  expect(await second.getAttribute("aria-checked")).toBe("false");
  expect(await config.disabled()).toBe(false);
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect(await second.getAttribute("aria-checked")).toBe("false");
  await expect.poll(() => plot.getAttribute("data-last")).toBe("0 0");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
});

test("an open configuration dialog disables every field and ignores changes during a run", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  await insert(page, "ScopeF32", 160, 200);
  await insert(page, "SinGenF32", 450, 200);
  await element(page, "[data-block-ref=ScopeF32] [data-port-side=output]").click();
  await element(page, "[data-block-ref=SinGenF32] [data-port-side=input]").click();
  await element(page, "[data-block-ref=SinGenF32] [data-block-config]").click();
  const dialog = element(page, "[data-block-config-dialog]");
  await expect.poll(() => dialog.shadow("dialog").visible()).toBe(true);
  const before = await dialog.within("input").evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
  // A modal blocks pointer access to Run; starting through the controller also
  // covers a dialog that stays open as the runtime state changes.
  await page.evaluate(() => {
    const workspace = document.querySelector("bld-workspace") as unknown as { runner: { toggle(): Promise<void> } };
    void workspace.runner.toggle();
  });
  const run = element(page, "[data-run-toggle]");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect(await dialog.within("input").evaluateAll(inputs => inputs.every(input => (input as HTMLInputElement).disabled))).toBe(true);
  await dialog.within("input").evaluateAll(inputs => inputs.forEach(input => {
    (input as HTMLInputElement).value = "123";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }));
  expect(await run.getAttribute("data-run-state")).toBe("running");
  await page.keyboard.press("Escape");
  await expect.poll(() => dialog.count()).toBe(0);
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  await element(page, "[data-block-ref=SinGenF32] [data-block-config]").click();
  await expect.poll(() => dialog.shadow("dialog").visible()).toBe(true);
  expect(await dialog.within("input").evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(before);
  expect(await dialog.within("input").evaluateAll(inputs => inputs.every(input => !(input as HTMLInputElement).disabled))).toBe(true);
});
