import { expect, test, element, baseURL, dialog as dialogElement, artifactPath, type BrowserElement, type Page } from "./fixtures/browser.ts";



class SelectionDiagram {
  readonly canvas: BrowserElement;
  readonly deleteButton: BrowserElement;

  constructor(private readonly page: Page) {
    this.canvas = element(page, "[data-diagram-canvas]");
    this.deleteButton = element(page, "[data-delete-selected]");
  }

  block(ref: string): BrowserElement {
    return this.canvas.within(`[data-block-ref=${ref}]`);
  }

  async insert(ref: string, x: number, y: number): Promise<void> {
    const source = element(this.page, `[data-region=palette] [data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const canvas = await this.canvas.boundingBox();
    expect(from && canvas).toBeTruthy();
    await source.click();
    await this.page.mouse.click(canvas!.x + x, canvas!.y + y);
    await expect.poll(() => this.block(ref).count()).toBe(1);
  }

  async connect(fromRef: string, toRef: string): Promise<void> {
    const from = await this.block(fromRef).within("[data-port-side=output]").boundingBox();
    const to = await this.block(toRef).within("[data-port-side=input]").boundingBox();
    expect(from && to).toBeTruthy();
    await this.page.mouse.click(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await this.page.mouse.click(to!.x + to!.width / 2, to!.y + to!.height / 2);
  }

  async selectWire(index = 0): Promise<BrowserElement> {
    const wire = this.canvas.within("[data-connection]").nth(index);
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
    await expect.poll(() => wire.getAttribute("data-selected"), { timeout: 5_000 }).toBe("true");
    return wire;
  }

  async pair(): Promise<void> {
    await this.insert("ScopeF32", 140, 170);
    await this.insert("ConstF32", 460, 170);
    await this.connect("ScopeF32", "ConstF32");
    await expect.poll(() => this.canvas.within("[data-connection]").count()).toBe(1);
  }
}

async function expectPulse(object: BrowserElement): Promise<void> {
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
  expect(pulse.minimum).toBeGreaterThanOrEqual(0.82);
  expect(pulse.minimum).toBeLessThan(0.85);
  expect(pulse.maximum).toBeGreaterThan(0.98);
}

test("selects blocks and connections with a slow 17% fade and deletes a wire from the toolbar", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await expect.poll(() => diagram.deleteButton.disabled()).toBe(true);
  await diagram.pair();
  const constant = diagram.block("ConstF32");
  await constant.click();
  await expect.poll(() => constant.getAttribute("data-selected")).toBe("true");
  await expectPulse(constant);
  const wire = await diagram.selectWire();
  await expect.poll(() => constant.getAttribute("data-selected")).toBe("false");
  await expectPulse(wire);
  await page.screenshot({ path: artifactPath("selected-connection.png") });
  await diagram.deleteButton.click();
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
  await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(2);
  await expect.poll(() => diagram.deleteButton.disabled()).toBe(true);
  // A later reroute must not resurrect the deleted edge.
  const origin = await constant.boundingBox();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2);
  await page.mouse.down();
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + origin!.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
  await diagram.connect("ScopeF32", "ConstF32");
  await expect.poll(() => diagram.canvas.within("[data-route-origin=maxgraph]").count()).toBe(1);
});

for (const key of ["Delete", "Backspace"] as const) {
  test(`${key} deletes a selected wire and a block with its attached connections`, async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
    const diagram = new SelectionDiagram(page);
    await diagram.pair();
    await diagram.selectWire();
    await page.keyboard.press(key);
    await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
    await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(2);
    await diagram.connect("ScopeF32", "ConstF32");
    await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(1);
    await diagram.block("ConstF32").click();
    await page.keyboard.press(key);
    await expect.poll(() => diagram.block("ConstF32").count()).toBe(0);
    await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
    await expect.poll(() => diagram.deleteButton.disabled()).toBe(true);
    await diagram.block("ScopeF32").click();
    await expect.poll(() => element(page, "[data-scope-plot]").visible()).toBe(true);
    await diagram.deleteButton.click();
    await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(0);
    await expect.poll(() => element(page, "[data-scope-plot]").count()).toBe(0);
  });
}

test("supports multiple selections and preserves blocks while editing configuration", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  await diagram.block("ConstF32").click();
  await diagram.block("ScopeF32").click({ modifiers: ["Control"] });
  await expect.poll(() => diagram.canvas.within("[data-diagram-block][data-selected=true]").count()).toBe(2);
  await diagram.block("ScopeF32").click({ modifiers: ["Shift"] });
  await expect.poll(() => diagram.canvas.within("[data-diagram-block][data-selected=true]").count()).toBe(1);
  await diagram.canvas.click({ position: { x: 700, y: 70 } });
  await expect.poll(() => diagram.deleteButton.disabled()).toBe(true);

  await diagram.block("ConstF32").click();
  await diagram.block("ConstF32").within("[data-block-config]").click();
  const dialog = dialogElement(page, "Constant");
  await expect.poll(() => dialog.visible(), { timeout: 10_000 }).toBe(true);
  const input = element(page, "[data-block-config-dialog] [data-config-field=value] input");
  await input.fill("123");
  await input.press("Backspace");
  await input.press("Delete");
  await expect.poll(() => input.value()).toBe("12");
  await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(2);
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => dialog.visible()).toBe(false);
  await diagram.block("ScopeF32").click({ modifiers: ["Control"] });
  await diagram.deleteButton.click();
  await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(0);
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
});

test("deleting a block stops the running diagram", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  const run = element(page, "[data-run-toggle]");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await diagram.block("ConstF32").click();
  await page.keyboard.press("Delete");
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  await expect.poll(() => diagram.block("ConstF32").count()).toBe(0);
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
});

test("connects only after selecting an output and then an input, with cancellation and keyboard support", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await diagram.insert("ScopeF32", 140, 170);
  await diagram.insert("SumF32", 370, 170);
  await diagram.insert("ConstF32", 600, 170);
  const output = diagram.block("ScopeF32").within("[data-port-side=output]");
  const otherOutput = diagram.block("SumF32").within("[data-port-side=output]");
  const input = diagram.block("ConstF32").within("[data-port-side=input]");
  const wires = diagram.canvas.within("[data-connection]");

  await input.click();
  await expect.poll(() => output.getAttribute("data-selected")).toBe("false");
  await expect.poll(() => wires.count()).toBe(0);
  await output.dragTo(input);
  await expect.poll(() => wires.count()).toBe(0);
  await expect.poll(() => output.getAttribute("data-selected")).toBe("false");
  await expect.poll(() => diagram.canvas.within(".diagram-wire.is-draft").count()).toBe(0);

  await output.click();
  await expect.poll(() => output.getAttribute("aria-pressed")).toBe("true");
  await expectPulse(output);
  await expect.poll(() => wires.count()).toBe(0);
  await output.click();
  await expect.poll(() => output.getAttribute("aria-pressed")).toBe("false");
  await output.click();
  await otherOutput.click();
  await expect.poll(() => output.getAttribute("data-selected")).toBe("false");
  await expect.poll(() => otherOutput.getAttribute("data-selected")).toBe("true");
  // An invalid self-connection leaves the selected output available.
  await diagram.block("SumF32").within("[data-port-side=input]").click();
  await expect.poll(() => wires.count()).toBe(0);
  await expect.poll(() => otherOutput.getAttribute("data-selected")).toBe("true");
  await page.keyboard.press("Escape");
  await expect.poll(() => otherOutput.getAttribute("data-selected")).toBe("false");
  await output.click();
  await diagram.canvas.click({ position: { x: 700, y: 70 } });
  await input.click();
  await expect.poll(() => wires.count()).toBe(0);

  await output.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => output.getAttribute("aria-pressed")).toBe("true");
  await input.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => wires.count()).toBe(1);
  await expect.poll(() => output.getAttribute("aria-pressed")).toBe("false");
  await otherOutput.click();
  await input.click();
  await expect.poll(() => wires.count()).toBe(2);
  await expect.poll(() => otherOutput.getAttribute("data-selected")).toBe("false");
  await otherOutput.click();
  await diagram.block("ConstF32").click();
  await expect.poll(() => otherOutput.getAttribute("data-selected")).toBe("false");
});

test("renders palette items, blocks, ports, and configuration controls as Lit custom elements", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  const paletteButton = element(page, "bld-palette-button:has([data-block-id=ConstF32])");
  await expect.poll(() => paletteButton.count()).toBe(1);
  await diagram.insert("ConstF32", 420, 170);
  const block = element(page, "bld-diagram-block:has([data-block-ref=ConstF32])");
  await expect.poll(() => block.count()).toBe(1);
  await expect.poll(() => block.within("bld-port-button button").count()).toBe(1);
  await expect.poll(() => block.within("bld-config-button button").count()).toBe(1);
  const registered = await page.evaluate(() => [
    "bld-app", "bld-workspace", "bld-palette-button", "bld-diagram-block", "bld-port-button", "bld-config-button",
  ].every((tag) => customElements.get(tag)?.prototype.requestUpdate instanceof Function));
  expect(registered).toBe(true);
});
