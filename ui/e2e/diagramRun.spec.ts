import { expect, test, element, baseURL, dialog as dialogElement, artifactPath } from "./fixtures/browser.ts";

test("removes the diagram caption, runs from the toolbar, and plots every scope output", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = element(page, "[data-region=diagram]");
  await expect.poll(() => diagram.within("h1").count()).toBe(0);
  const run = element(page, "[data-toolbar] [data-run-toggle]");
  await expect.poll(() => run.text()).toBe("Run");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");

  const palette = element(page, "[data-region=palette]");
  const canvas = element(page, "[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  async function insert(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.within(`[data-block-id=${blockId}]`);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await source.click();
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
  await expect.poll(() => plot.within("[data-scope-series]").count()).toBe(2);
  await expect.poll(() => plot.text()).toContain("sin");
  await expect.poll(() => plot.text()).toContain("cos");
  await expect.poll(() => canvas.within("[data-block-ref=ScopeF32]").getAttribute("data-inspected")).toBe("true");

  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("starting");
  await expect.poll(() => run.text()).toBe("Run");
  await expect.poll(() => run.text(), { timeout: 120_000 }).toBe("Stop");
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

  await run.click();
  await expect.poll(() => run.text()).toBe("Run");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
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
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await source.click();
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
  await expect.poll(() => run.text(), { timeout: 120_000 }).toBe("Stop");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await expect.poll(() => element(page, "[data-run-status]").text()).toBe("");
  await expect.poll(() => plot.getAttribute("data-samples"), { timeout: 10_000 }).toBe("100");
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-min"))).toBeLessThan(0.1);
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-max"))).toBeGreaterThan(1.9);
  const previous = await plot.getAttribute("data-last");
  await expect.poll(() => plot.getAttribute("data-last")).not.toBe(previous);
  await expect.poll(() => plot.getAttribute("data-samples")).toBe("100");
  expect(Number(await plot.getAttribute("data-sample-min"))).toBeGreaterThanOrEqual(-0.001);
  expect(Number(await plot.getAttribute("data-sample-max"))).toBeLessThanOrEqual(2.001);
  await page.screenshot({ path: artifactPath("sine-sum-scope.png") });

  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
});
