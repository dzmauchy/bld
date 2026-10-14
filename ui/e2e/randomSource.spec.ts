import { closePalette, openPalette, expect, test, element, baseURL, artifactPath } from "./fixtures/browser.ts";

for (const precision of ["F32", "F64"] as const) {
  test(`Random ${precision} produces changing values in the browser scope`, async ({ page }) => {
    await page.goto(baseURL());
    await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
    const canvas = element(page, "[data-diagram-canvas]");
    for (const [ref, x] of [[`Scope${precision}`, 160], [`RandGen${precision}`, 440]] as const) {
      await openPalette(page);
      const source = element(page, `[data-region=palette] [data-block-id=${ref}]`);
      await source.scrollIntoViewIfNeeded();
      await source.click();
      await closePalette(page);
      await canvas.click({ position: { x, y: 180 } });
    }
    await canvas.within(`[data-block-ref=Scope${precision}] [data-port-side=output]`).click();
    await canvas.within(`[data-block-ref=RandGen${precision}] [data-port-side=input]`).click();
    await canvas.within(`[data-block-ref=Scope${precision}]`).click();
    const plot = element(page, "[data-scope-plot]");
    const run = element(page, "[data-run-toggle]");
    await run.click();
    await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
    await expect.poll(async () => Number(await plot.getAttribute("data-samples"))).toBeGreaterThan(30);
    const minimum = Number(await plot.getAttribute("data-sample-min"));
    const maximum = Number(await plot.getAttribute("data-sample-max"));
    await page.screenshot({ path: artifactPath(`random-${precision}.png`) });
    expect(maximum - minimum, `observed random range ${minimum}..${maximum}`).toBeGreaterThan(0.1);
    expect(minimum).toBeGreaterThanOrEqual(0);
    expect(maximum).toBeLessThanOrEqual(1);
    const previous = await plot.getAttribute("data-last");
    await expect.poll(() => plot.getAttribute("data-last")).not.toBe(previous);
    await run.click();
    await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  });
}
