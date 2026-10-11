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

  async function drop(blockId: string, clientX: number, clientY: number): Promise<void> {
    const source = palette.locator(`[data-block-id=${blockId}]`);
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(clientX, clientY, { steps: 12 });
    await page.mouse.up();
  }

  const y = canvasBox!.y + 150;
  await drop("ScopeF32", canvasBox!.x + 130, y);
  await drop("SinGenF32", canvasBox!.x + 460, y - 80);
  await drop("CosGenF32", canvasBox!.x + 460, y + 80);

  const output = canvas.locator("[data-block-ref=ScopeF32] [data-port-side=output]");
  for (const [index, ref] of ["SinGenF32", "CosGenF32"].entries()) {
    const input = canvas.locator(`[data-block-ref=${ref}] [data-port-side=input]`);
    const outputBox = await output.boundingBox();
    const inputBox = await input.boundingBox();
    expect(outputBox).toBeTruthy();
    expect(inputBox).toBeTruthy();
    await page.mouse.move(outputBox!.x + outputBox!.width / 2, outputBox!.y + outputBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(inputBox!.x + inputBox!.width / 2, inputBox!.y + inputBox!.height / 2, { steps: 16 });
    await page.mouse.up();
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
  await page.screenshot({ path: "/opt/cursor/artifacts/scope-plot.png" });

  await run.click();
  await expect(run).toHaveText("Run");
  await expect(run).toHaveAttribute("data-run-state", "idle");
});
