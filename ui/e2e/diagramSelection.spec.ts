import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
});

class SelectionDiagram {
  readonly canvas: Locator;
  readonly deleteButton: Locator;

  constructor(private readonly page: Page) {
    this.canvas = page.locator("[data-diagram-canvas]");
    this.deleteButton = page.locator("[data-delete-selected]");
  }

  block(ref: string): Locator {
    return this.canvas.locator(`[data-block-ref=${ref}]`);
  }

  async drop(ref: string, x: number, y: number): Promise<void> {
    const source = this.page.locator(`[data-region=palette] [data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const canvas = await this.canvas.boundingBox();
    expect(from && canvas).toBeTruthy();
    await this.page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(canvas!.x + x, canvas!.y + y, { steps: 10 });
    await this.page.mouse.up();
    await expect(this.block(ref)).toHaveCount(1);
  }

  async connect(fromRef: string, toRef: string): Promise<void> {
    const from = await this.block(fromRef).locator("[data-port-side=output]").boundingBox();
    const to = await this.block(toRef).locator("[data-port-side=input]").boundingBox();
    expect(from && to).toBeTruthy();
    await this.page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
    await this.page.mouse.up();
  }

  async selectWire(index = 0): Promise<Locator> {
    const wire = this.canvas.locator("[data-connection]").nth(index);
    const midpoint = await wire.evaluate((element) => {
      const polyline = element as SVGPolylineElement;
      const points = [...polyline.points];
      let longest = 0;
      let midpoint = new DOMPoint();
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!;
        const to = points[i]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        if (length > longest) {
          longest = length;
          midpoint = new DOMPoint((from.x + to.x) / 2, (from.y + to.y) / 2);
        }
      }
      const screen = midpoint.matrixTransform(polyline.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    // The transparent hit stroke extends seven pixels either side of the line.
    await this.page.mouse.click(midpoint.x, midpoint.y + 4);
    await expect(wire).toHaveAttribute("data-selected", "true", { timeout: 5_000 });
    return wire;
  }

  async pair(): Promise<void> {
    await this.drop("ScopeF32", 140, 170);
    await this.drop("ConstF32", 460, 170);
    await this.connect("ScopeF32", "ConstF32");
    await expect(this.canvas.locator("[data-connection]")).toHaveCount(1);
  }
}

async function expectPulse(object: Locator): Promise<void> {
  const pulse = await object.evaluate(async (element) => {
    const samples: number[] = [];
    const animation = getComputedStyle(element).animationName;
    const duration = getComputedStyle(element).animationDuration;
    for (let i = 0; i < 28; i++) {
      samples.push(Number(getComputedStyle(element).opacity));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { animation, duration, minimum: Math.min(...samples), maximum: Math.max(...samples) };
  });
  expect(pulse.animation).toBe("diagram-selection-pulse");
  expect(pulse.duration).toBe("2.4s");
  expect(pulse.minimum).toBeGreaterThanOrEqual(0.89);
  expect(pulse.minimum).toBeLessThan(0.92);
  expect(pulse.maximum).toBeGreaterThan(0.98);
}

test("selects blocks and connections with a slow 10% fade and deletes a wire from the toolbar", async ({ page }) => {
  const diagram = new SelectionDiagram(page);
  await expect(diagram.deleteButton).toBeDisabled();
  await diagram.pair();
  const constant = diagram.block("ConstF32");
  await constant.click();
  await expect(constant).toHaveAttribute("data-selected", "true");
  await expectPulse(constant);
  const wire = await diagram.selectWire();
  await expect(constant).toHaveAttribute("data-selected", "false");
  await expectPulse(wire);
  await page.screenshot({ path: test.info().outputPath("selected-connection.png") });
  await diagram.deleteButton.click();
  await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
  await expect(diagram.canvas.locator("[data-diagram-block]")).toHaveCount(2);
  await expect(diagram.deleteButton).toBeDisabled();
  // A later reroute must not resurrect the deleted edge.
  const origin = await constant.boundingBox();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
  await page.mouse.down();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
  await diagram.connect("ScopeF32", "ConstF32");
  await expect(diagram.canvas.locator("[data-route-origin=maxgraph]")).toHaveCount(1);
});

for (const key of ["Delete", "Backspace"]) {
  test(`${key} deletes a selected wire and a block with its attached connections`, async ({ page }) => {
    const diagram = new SelectionDiagram(page);
    await diagram.pair();
    await diagram.selectWire();
    await page.keyboard.press(key);
    await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
    await expect(diagram.canvas.locator("[data-diagram-block]")).toHaveCount(2);
    await diagram.connect("ScopeF32", "ConstF32");
    await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(1);
    await diagram.block("ConstF32").click();
    await page.keyboard.press(key);
    await expect(diagram.block("ConstF32")).toHaveCount(0);
    await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
    await expect(diagram.deleteButton).toBeDisabled();
    await diagram.block("ScopeF32").click();
    await expect(page.locator("[data-scope-plot]")).toBeVisible();
    await diagram.deleteButton.click();
    await expect(diagram.canvas.locator("[data-diagram-block]")).toHaveCount(0);
    await expect(page.locator("[data-scope-plot]")).toHaveCount(0);
  });
}

test("supports multiple selections and preserves blocks while editing configuration", async ({ page }) => {
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  await diagram.block("ConstF32").click();
  await diagram.block("ScopeF32").click({ modifiers: ["Control"] });
  await expect(diagram.canvas.locator("[data-diagram-block][data-selected=true]")).toHaveCount(2);
  await diagram.block("ScopeF32").click({ modifiers: ["Shift"] });
  await expect(diagram.canvas.locator("[data-diagram-block][data-selected=true]")).toHaveCount(1);
  await diagram.canvas.click({ position: { x: 700, y: 70 } });
  await expect(diagram.deleteButton).toBeDisabled();

  await diagram.block("ConstF32").click();
  await diagram.block("ConstF32").locator("[data-block-config]").click();
  const dialog = page.getByRole("dialog", { name: "Constant", exact: true });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const input = page.locator("[data-block-config-dialog] [data-config-field=value] input");
  await input.fill("123");
  await input.press("Backspace");
  await input.press("Delete");
  await expect(input).toHaveValue("12");
  await expect(diagram.canvas.locator("[data-diagram-block]")).toHaveCount(2);
  await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await diagram.block("ScopeF32").click({ modifiers: ["Control"] });
  await diagram.deleteButton.click();
  await expect(diagram.canvas.locator("[data-diagram-block]")).toHaveCount(0);
  await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
});

test("deleting a block stops the running diagram", async ({ page }) => {
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  const run = page.locator("[data-run-toggle]");
  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "running");
  await diagram.block("ConstF32").click();
  await page.keyboard.press("Delete");
  await expect(run).toHaveAttribute("data-run-state", "idle");
  await expect(diagram.block("ConstF32")).toHaveCount(0);
  await expect(diagram.canvas.locator("[data-connection]")).toHaveCount(0);
});
