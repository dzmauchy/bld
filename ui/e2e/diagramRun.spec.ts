import { closePalette, openPalette, expect, test, element, baseURL, dialog as dialogElement, artifactPath } from "./fixtures/browser.ts";

interface SignalTimingProbe {
  times: number[];
  delayedTicks: number;
}

test("keeps sine samples evenly spaced when worker calls are delayed with vintage effects enabled", async ({ page }) => {
  await page.evaluateOnNewDocument(() => {
    const probe: SignalTimingProbe = { times: [], delayedTicks: 0 };
    (window as unknown as { signalTimingProbe: SignalTimingProbe }).signalTimingProbe = probe;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { type?: string; name?: string; args?: number[] };
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        };
        if (request.type === "invoke" && request.name === "setNow") probe.times.push(request.args![0]!);
        if (request.type === "invoke" && request.name === "tick" && probe.delayedTicks > 0) {
          probe.delayedTicks--;
          setTimeout(send, 120);
        } else send();
      }
    };
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
  const plot = element(page, "[data-scope-plot]");
  const run = element(page, "[data-run-toggle]");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await expect.poll(async () => Number(await plot.getAttribute("data-samples"))).toBeGreaterThan(20);
  expect(await plot.getAttribute("data-scope-effects")).toBe("vintage");
  const count = await page.evaluate(() => {
    const probe = (window as unknown as { signalTimingProbe: SignalTimingProbe }).signalTimingProbe;
    probe.delayedTicks = 6;
    return probe.times.length;
  });
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { signalTimingProbe: SignalTimingProbe }).signalTimingProbe.delayedTicks)).toBe(0);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { signalTimingProbe: SignalTimingProbe }).signalTimingProbe.times.length)).toBeGreaterThan(count + 6);
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  const times = await page.evaluate(() =>
    (window as unknown as { signalTimingProbe: SignalTimingProbe }).signalTimingProbe.times);
  expect(times[0]).toBe(10);
  expect(times.slice(1).every((time, index) => time - times[index]! === 10)).toBe(true);
  await page.screenshot({ path: artifactPath("sine-with-delayed-worker.png") });
});

test("rejects a product with missing source connections and runs the corrected generator diagram", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const canvas = element(page, "[data-diagram-canvas]");
  const run = element(page, "[data-run-toggle]");

  async function insert(ref: string, x: number, y: number): Promise<void> {
    await openPalette(page);
    const source = element(page, `[data-region=palette] [data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    await source.click();
    await closePalette(page);
    await canvas.click({ position: { x, y } });
    await expect.poll(() => canvas.within(`[data-block-ref=${ref}]`).count()).toBe(1);
  }

  async function connect(from: string, to: string): Promise<void> {
    await canvas.within(`[data-block-ref=${from}] [data-port-side=output]`).click();
    await canvas.within(`[data-block-ref=${to}] [data-port-side=input]`).click();
  }

  // Reproduce the screenshot: both unary transformers have unconnected
  // consumer ports, so neither ever receives a value to send to Product.
  await insert("ScopeF32", 160, 180);
  await insert("ConstF32", 400, 110);
  await insert("ProductF32", 430, 330);
  await insert("SinF32", 690, 260);
  await insert("CosF32", 690, 410);
  await connect("ScopeF32", "ConstF32");
  await connect("ScopeF32", "ProductF32");
  await connect("ProductF32", "SinF32");
  await connect("ProductF32", "CosF32");
  await canvas.within("[data-block-ref=ScopeF32]").click();
  const plot = element(page, "[data-scope-plot]");
  await run.click();
  const error = dialogElement(page, "Diagram cannot run");
  await expect.poll(() => error.visible()).toBe(true);
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  expect(await element(page, "[data-run-error]").text()).toContain("sin: port “consumer” has no connection.");
  expect(await element(page, "[data-run-error]").text()).toContain("cos: port “consumer” has no connection.");
  expect(await plot.getAttribute("data-samples")).toBe("0");
  await page.screenshot({ path: artifactPath("product-without-sources.png") });
  await element(page, "[data-dismiss-run-error]").click();
  await expect.poll(() => error.visible()).toBe(false);

  for (const ref of ["SinF32", "CosF32"]) {
    await canvas.within(`[data-block-ref=${ref}]`).click();
    await element(page, "[data-delete-selected]").click();
    await expect.poll(() => canvas.within(`[data-block-ref=${ref}]`).count()).toBe(0);
  }
  await insert("SinGenF32", 690, 260);
  await insert("CosGenF32", 690, 410);
  await connect("ProductF32", "SinGenF32");
  await connect("ProductF32", "CosGenF32");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await expect.poll(() => element(page, "[data-run-status]").text()).toBe("");
  await expect.poll(async () => Number(await plot.getAttribute("data-samples"))).toBeGreaterThan(100);
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-min"))).toBeLessThan(-0.4);
  expect(Number(await plot.getAttribute("data-sample-max"))).toBe(1);
  const previous = await plot.getAttribute("data-last");
  await expect.poll(() => plot.getAttribute("data-last")).not.toBe(previous);
  await page.screenshot({ path: artifactPath("product-with-generators.png") });
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
});

test("runs from the menu, plots every scope output, and toggles vintage effects without changing samples", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = element(page, "[data-region=diagram]");
  await expect.poll(() => diagram.within("h1").count()).toBe(0);
  const run = element(page, "[data-toolbar] [data-run-toggle]");
  await expect.poll(() => run.getAttribute("aria-label")).toBe("Run");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");

  const palette = element(page, "[data-region=palette]");
  const canvas = element(page, "[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  async function insert(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.within(`[data-block-id=${blockId}]`);
    await openPalette(page);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await source.click();
    await closePalette(page);
    await page.mouse.click(clientX, clientY);
  }

  const y = canvasBox!.y + 150;
  await insert("ScopeF32", canvasBox!.x + 130, y);
  await insert("SinGenF32", canvasBox!.x + 460, y - 80);
  await insert("CosGenF32", canvasBox!.x + 460, y + 80);

  const output = canvas.within("[data-block-ref=ScopeF32] [data-port-side=output]");
  for (const [index, ref] of ["SinGenF32", "CosGenF32"].entries()) {
    const input = canvas.within(`[data-block-ref=${ref}] [data-port-side=input]`);
    const outputBox = await output.boundingBox();
    const inputBox = await input.boundingBox();
    expect(outputBox).toBeTruthy();
    expect(inputBox).toBeTruthy();
    await page.mouse.click(outputBox!.x + outputBox!.width / 2, outputBox!.y + outputBox!.height / 2);
    await page.mouse.click(inputBox!.x + inputBox!.width / 2, inputBox!.y + inputBox!.height / 2);
    await expect.poll(() => canvas.within("[data-connection]").count()).toBe(index + 1);
  }

  await canvas.within("[data-block-ref=ScopeF32]").click();
  const plot = element(page, "[data-scope-plot]");
  await expect.poll(() => plot.visible()).toBe(true);
  await expect.poll(() => plot.getAttribute("data-axis")).toBe("shared");
  await expect.poll(() => plot.getAttribute("data-series-count")).toBe("2");
  await expect.poll(() => plot.getAttribute("data-domain-seconds")).toBe("60");
  expect(await plot.getAttribute("data-axis-seconds")).toBe("60");
  expect(await plot.getAttribute("data-window-capacity")).toBe("6000");
  await expect.poll(() => plot.within("[data-scope-series]").count()).toBe(2);
  await expect.poll(() => plot.text()).toContain("sin");
  await expect.poll(() => plot.text()).toContain("cos");
  await expect.poll(() => canvas.within("[data-block-ref=ScopeF32]").getAttribute("data-inspected")).toBe("true");

  await element(page, "[data-menu-toggle]").click();
  await expect.poll(() => element(page, "[data-menu-run]").visible()).toBe(true);
  await element(page, "[data-menu-run]").click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("starting");
  await expect.poll(() => run.getAttribute("aria-label")).toBe("Run");
  await expect.poll(() => run.getAttribute("aria-label"), { timeout: 120_000 }).toBe("Stop");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");

  const trace = () => element(page, "[data-scope-canvas]").evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext("2d");
    if (!context || element.width === 0) return "";
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let ink = 0;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 16) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      checksum = (checksum + red * 3 + green * 5 + blue * 7) % 1000003;
      if (red + green + blue > 180) ink += 1;
    }
    return `${ink}:${checksum}`;
  });
  await expect.poll(trace, { timeout: 10_000 }).not.toBe("");
  const first = await trace();
  await expect.poll(async () => trace(), { timeout: 5_000 }).not.toBe(first);
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.screenshot({ path: artifactPath("scope-plot.png") });

  await element(page, "[data-menu-toggle]").click();
  await expect.poll(() => element(page, "[data-menu-run]").text()).toBe("Stop");
  await element(page, "[data-menu-run]").click();
  await expect.poll(() => run.getAttribute("aria-label")).toBe("Run");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");

  const vintage = await trace();
  const samples = await plot.getAttribute("data-samples");
  expect(await plot.getAttribute("data-scope-effects")).toBe("vintage");
  const menu = element(page, "[data-menu-toggle]");
  const effects = element(page, "[data-menu-scope-effects]");
  await menu.click();
  await expect.poll(() => effects.visible()).toBe(true);
  await effects.click();
  await expect.poll(() => plot.getAttribute("data-scope-effects")).toBe("off");
  await expect.poll(trace).not.toBe(vintage);
  expect(await element(page, ".scope-screen").evaluate(screen => getComputedStyle(screen, "::before").content)).toBe("none");
  expect(await plot.getAttribute("data-samples")).toBe(samples);
  await page.screenshot({ path: artifactPath("scope-effects-off.png") });
  await plot.within("[data-scope-close]").click();
  await expect.poll(() => plot.count()).toBe(0);
  await canvas.within("[data-block-ref=ScopeF32]").click();
  await expect.poll(() => plot.getAttribute("data-scope-effects")).toBe("off");
  await menu.click();
  await expect.poll(() => effects.getAttribute("aria-checked")).toBe("false");
  await effects.click();
  await expect.poll(() => plot.getAttribute("data-scope-effects")).toBe("vintage");
  await expect.poll(trace).toBe(vintage);
  expect(await plot.getAttribute("data-samples")).toBe(samples);
  await page.screenshot({ path: artifactPath("scope-effects-vintage.png") });
});

test("plots a sliding 1 + sin(t) trace from a constant and a sine generator", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const palette = element(page, "[data-region=palette]");
  const canvas = element(page, "[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  async function insert(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.within(`[data-block-id=${blockId}]`);
    await openPalette(page);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await source.click();
    await closePalette(page);
    await page.mouse.click(clientX, clientY);
    await expect.poll(() => canvas.within(`[data-block-ref=${blockId}]`).count()).toBe(1);
  }

  async function connect(fromRef: string, toRef: string): Promise<void> {
    const from = canvas.within(`[data-block-ref=${fromRef}] [data-port-side=output]`);
    const to = canvas.within(`[data-block-ref=${toRef}] [data-port-side=input]`);
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    expect(fromBox).toBeTruthy();
    expect(toBox).toBeTruthy();
    await page.mouse.click(fromBox!.x + fromBox!.width / 2, fromBox!.y + fromBox!.height / 2);
    await page.mouse.click(toBox!.x + toBox!.width / 2, toBox!.y + toBox!.height / 2);
  }

  const y = canvasBox!.y + 200;
  await insert("ScopeF32", canvasBox!.x + 140, y);
  await insert("SumF32", canvasBox!.x + 380, y);
  await insert("ConstF32", canvasBox!.x + 640, y - 110);
  await insert("SinGenF32", canvasBox!.x + 640, y + 110);
  await expect.poll(() => canvas.within("[data-block-ref=ConstF32] [data-block-config]").count()).toBe(1);
  await expect.poll(() => canvas.within("[data-block-ref=SumF32] [data-block-config]").count()).toBe(1);
  await expect.poll(() => canvas.within("[data-block-ref=ScopeF32] [data-block-config]").count()).toBe(1);
  await expect.poll(() => canvas.within("[data-block-ref=SinGenF32] [data-block-config]").count()).toBe(1);
  await connect("ScopeF32", "SumF32");
  await connect("SumF32", "ConstF32");
  await connect("SumF32", "SinGenF32");
  await expect.poll(() => canvas.within("[data-block-ref=SumF32] [data-port-side=output]").getAttribute("data-port-lanes")).toBe("2");

  await canvas.within("[data-block-ref=ScopeF32] [data-block-config]").click();
  const configuration = element(page, "[data-block-config-dialog]");
  const dialog = dialogElement(page, "Scope");
  await expect.poll(() => dialog.visible(), { timeout: 10_000 }).toBe(true);
  await configuration.within("[data-config-field=period] input").evaluate((element) => {
    (element as HTMLInputElement).value = "1";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press("Escape");
  await expect.poll(() => dialog.visible(), { timeout: 10_000 }).toBe(false);

  await canvas.within("[data-block-ref=ScopeF32]").click();
  const plot = element(page, "[data-scope-plot]");
  await expect.poll(() => plot.visible()).toBe(true);
  await expect.poll(() => plot.getAttribute("data-series-count")).toBe("1");
  await expect.poll(() => plot.getAttribute("data-domain-seconds")).toBe("1");
  await expect.poll(() => plot.text()).toContain("Sum");

  const run = element(page, "[data-toolbar] [data-run-toggle]");
  await run.click();
  await expect.poll(() => run.getAttribute("aria-label"), { timeout: 120_000 }).toBe("Stop");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await expect.poll(() => element(page, "[data-run-status]").text()).toBe("");
  expect(await plot.getAttribute("data-window-capacity")).toBe("100");
  await expect.poll(async () => Number(await plot.getAttribute("data-samples"))).toBeGreaterThan(10);
  expect(Number(await plot.getAttribute("data-samples"))).toBeLessThan(100);
  expect(await plot.getAttribute("data-axis-seconds")).toBe("1");
  await page.screenshot({ path: artifactPath("scope-partial-fixed-window.png") });
  await expect.poll(() => plot.getAttribute("data-samples"), { timeout: 10_000 }).toBe("100");
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-min"))).toBeLessThan(0.1);
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-max"))).toBeGreaterThan(1.9);
  const previous = await plot.getAttribute("data-last");
  await expect.poll(() => plot.getAttribute("data-last")).not.toBe(previous);
  await expect.poll(() => plot.getAttribute("data-samples")).toBe("100");
  expect(await plot.getAttribute("data-axis-seconds")).toBe("1");
  expect(Number(await plot.getAttribute("data-sample-min"))).toBeGreaterThanOrEqual(-0.001);
  expect(Number(await plot.getAttribute("data-sample-max"))).toBeLessThanOrEqual(2.001);
  await page.screenshot({ path: artifactPath("sine-sum-scope.png") });

  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
});
