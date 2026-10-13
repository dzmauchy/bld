import { writeFile } from "node:fs/promises";
import type { ScopePlot } from "ui/view/scope/ScopePlot.ts";
import { closePalette, openPalette, expect, test, element, baseURL, artifactPath } from "./fixtures/browser.ts";

test("bounds scope drawing work as the fixed data window fills", async ({ page }) => {
  await page.evaluateOnNewDocument(() => {
    const probe = { frames: 0, segments: 0 };
    (window as unknown as { scopePaintProbe: typeof probe }).scopePaintProbe = probe;
    new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (!(record.target instanceof SVGPathElement) || !record.target.matches("[data-scope-trace]")) continue;
        changed = true;
        probe.segments += (record.target.getAttribute("d")?.match(/[ML]/g) ?? []).length;
      }
      if (changed) probe.frames++;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["d"] });
  });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const canvas = element(page, "[data-diagram-canvas]");
  for (const [ref, x] of [["ScopeF32", 160], ["SinGenF32", 420]] as const) {
    await openPalette(page);
    const source = element(page, `[data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    await source.click();
    await closePalette(page);
    await canvas.click({ position: { x, y: 180 } });
  }
  await canvas.within("[data-block-ref=ScopeF32] [data-port-side=output]").click();
  await canvas.within("[data-block-ref=SinGenF32] [data-port-side=input]").click();
  await canvas.within("[data-block-ref=ScopeF32]").click();
  const run = element(page, "[data-run-toggle]");
  const plot = element(page, "[data-scope-plot]");
  expect(await plot.within("canvas").count()).toBe(0);
  expect(await plot.within("svg path[data-scope-trace]").count()).toBe(1);
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  const client = await page.createCDPSession();
  await client.send("Performance.enable");
  await client.send("Profiler.enable");
  const measure = async () => {
    const before = await client.send("Performance.getMetrics");
    await page.evaluate(() => {
      const probe = (window as unknown as { scopePaintProbe: { frames: number; segments: number } }).scopePaintProbe;
      probe.frames = 0;
      probe.segments = 0;
    });
    const stats = await page.evaluate(async () => {
      const started = performance.now();
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { ...(window as unknown as { scopePaintProbe: { frames: number; segments: number } }).scopePaintProbe,
        elapsed: performance.now() - started };
    });
    const after = await client.send("Performance.getMetrics");
    const task = (metrics: typeof after.metrics) => metrics.find(metric => metric.name === "TaskDuration")!.value;
    return { ...stats, taskSeconds: task(after.metrics) - task(before.metrics) };
  };
  const partial = await measure();
  // Fill the same ring to represent a long-running scope without waiting a minute.
  await plot.evaluate(node => {
    const view = node.parentElement as ScopePlot;
    const monitor = view.board!.monitorFor(view.editor!.model, view.blockId!)!;
    for (let index = 0; index < monitor.capacity; index++) {
      monitor.accept(0, Math.sin(index * Math.PI / 50));
      monitor.sample(10);
    }
  });
  await expect.poll(() => plot.getAttribute("data-samples")).toBe("6000");
  await client.send("Profiler.start");
  const full = await measure();
  const { profile } = await client.send("Profiler.stop");
  await writeFile(artifactPath("full-scope-profile.json"), JSON.stringify(profile));
  await page.screenshot({ path: artifactPath("full-scope-window.png") });
  await plot.within("[data-scope-close]").click();
  const closed = await measure();
  await writeFile(artifactPath("scope-performance.json"), JSON.stringify({ partial, full, closed }, null, 2));
  console.log("SCOPE PERFORMANCE", JSON.stringify({ partial, full, closed }));
  await run.click();
  expect(full.frames * 1000 / full.elapsed).toBeLessThanOrEqual(32);
  expect(full.frames).toBeGreaterThan(0);
  expect(full.segments / full.frames).toBeLessThanOrEqual(4 * 1280 + 10);
  expect(closed.frames).toBe(0);
});
