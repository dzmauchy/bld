import { expect, test } from "@playwright/test";

test("removes the diagram caption, runs from the toolbar, and plots every scope output", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const diagram = page.locator("[data-region=diagram]");
  await expect(diagram.locator("h1")).toHaveCount(0);
  const run = page.locator("[data-toolbar] [data-run-toggle]");
  await expect(run).toHaveText("Run");
  await expect(run).toHaveAttribute("data-run-state", "idle");

  const palette = page.locator("[data-region=palette]");
  const canvas = page.locator("[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  async function insert(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.locator(`[data-block-id=${blockId}]`);
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

  const output = canvas.locator("[data-block-ref=ScopeF32] [data-port-side=output]");
  for (const [index, ref] of ["SinGenF32", "CosGenF32"].entries()) {
    const input = canvas.locator(`[data-block-ref=${ref}] [data-port-side=input]`);
    const outputBox = await output.boundingBox();
    const inputBox = await input.boundingBox();
    expect(outputBox).toBeTruthy();
    expect(inputBox).toBeTruthy();
    await page.mouse.click(outputBox!.x + outputBox!.width / 2, outputBox!.y + outputBox!.height / 2);
    await page.mouse.click(inputBox!.x + inputBox!.width / 2, inputBox!.y + inputBox!.height / 2);
    await expect(canvas.locator("[data-connection]")).toHaveCount(index + 1);
  }

  await canvas.locator("[data-block-ref=ScopeF32]").click();
  const plot = page.locator("[data-scope-plot]");
  await expect(plot).toBeVisible();
  await expect(plot).toHaveAttribute("data-axis", "shared");
  await expect(plot).toHaveAttribute("data-series-count", "2");
  await expect(plot).toHaveAttribute("data-domain-seconds", "60");
  await expect(plot.locator("[data-scope-series]")).toHaveCount(2);
  await expect(plot).toContainText("sin");
  await expect(plot).toContainText("cos");
  await expect(canvas.locator("[data-block-ref=ScopeF32]")).toHaveAttribute("data-inspected", "true");

  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "starting");
  await expect(run).toHaveText("Run");
  await expect(run).toHaveText("Stop", { timeout: 120_000 });
  await expect(run).toHaveAttribute("data-run-state", "running");

  const trace = () => page.locator("[data-scope-canvas]").evaluate((canvas) => {
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
  await page.waitForTimeout(700);
  await page.screenshot({ path: test.info().outputPath("scope-plot.png") });

  await run.click();
  await expect(run).toHaveText("Run");
  await expect(run).toHaveAttribute("data-run-state", "idle");
});

test("plots a sliding 1 + sin(t) trace from a constant and a sine generator", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const palette = page.locator("[data-region=palette]");
  const canvas = page.locator("[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  async function insert(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.locator(`[data-block-id=${blockId}]`);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await source.click();
    await page.mouse.click(clientX, clientY);
    await expect(canvas.locator(`[data-block-ref=${blockId}]`)).toHaveCount(1);
  }

  async function connect(fromRef: string, toRef: string): Promise<void> {
    const from = canvas.locator(`[data-block-ref=${fromRef}] [data-port-side=output]`);
    const to = canvas.locator(`[data-block-ref=${toRef}] [data-port-side=input]`);
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
  await expect(canvas.locator("[data-block-ref=ConstF32] [data-block-config]")).toHaveCount(1);
  await expect(canvas.locator("[data-block-ref=SumF32] [data-block-config]")).toHaveCount(1);
  await expect(canvas.locator("[data-block-ref=ScopeF32] [data-block-config]")).toHaveCount(1);
  await expect(canvas.locator("[data-block-ref=SinGenF32] [data-block-config]")).toHaveCount(1);
  await connect("ScopeF32", "SumF32");
  await connect("SumF32", "ConstF32");
  await connect("SumF32", "SinGenF32");
  await expect(canvas.locator("[data-block-ref=SumF32] [data-port-side=output]")).toHaveAttribute("data-port-lanes", "2");

  await canvas.locator("[data-block-ref=ScopeF32] [data-block-config]").click();
  const configuration = page.locator("[data-block-config-dialog]");
  const dialog = page.getByRole("dialog", { name: "Scope", exact: true });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await configuration.locator("[data-config-field=period] input").evaluate((element) => {
    (element as HTMLInputElement).value = "1";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  await canvas.locator("[data-block-ref=ScopeF32]").click();
  const plot = page.locator("[data-scope-plot]");
  await expect(plot).toBeVisible();
  await expect(plot).toHaveAttribute("data-series-count", "1");
  await expect(plot).toHaveAttribute("data-domain-seconds", "1");
  await expect(plot).toContainText("Sum");

  const run = page.locator("[data-toolbar] [data-run-toggle]");
  await run.click();
  await expect(run).toHaveText("Stop", { timeout: 120_000 });
  await expect(run).toHaveAttribute("data-run-state", "running");
  await expect(page.locator("[data-run-status]")).toHaveText("");
  await expect(plot).toHaveAttribute("data-samples", "100", { timeout: 10_000 });
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-min"))).toBeLessThan(0.1);
  await expect.poll(async () => Number(await plot.getAttribute("data-sample-max"))).toBeGreaterThan(1.9);
  const previous = await plot.getAttribute("data-last");
  await expect.poll(() => plot.getAttribute("data-last")).not.toBe(previous);
  await expect(plot).toHaveAttribute("data-samples", "100");
  expect(Number(await plot.getAttribute("data-sample-min"))).toBeGreaterThanOrEqual(-0.001);
  expect(Number(await plot.getAttribute("data-sample-max"))).toBeLessThanOrEqual(2.001);
  await page.screenshot({ path: test.info().outputPath("sine-sum-scope.png") });

  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "idle");
});
