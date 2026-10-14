import { closePalette, openPalette, expect, test, element, baseURL, dialog as dialogElement, artifactPath, type BrowserElement, type Page } from "./fixtures/browser.ts";



class SelectionDiagram {
  readonly canvas: BrowserElement;
  readonly deleteButton: BrowserElement;

  constructor(private readonly page: Page) {
    this.canvas = element(page, "[data-diagram-canvas]");
    this.deleteButton = element(page, "[data-context-delete]");
  }

  block(ref: string): BrowserElement {
    return this.canvas.within(`[data-block-ref=${ref}]`);
  }

  async insert(ref: string, x: number, y: number): Promise<void> {
    const source = element(this.page, `[data-region=palette] [data-block-id=${ref}]`);
    await openPalette(this.page);
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const canvas = await this.canvas.boundingBox();
    expect(from && canvas).toBeTruthy();
    await source.click();
    await closePalette(this.page);
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

  async openBlockMenu(ref: string): Promise<void> {
    const box = await this.block(ref).boundingBox();
    expect(box).toBeTruthy();
    await this.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "right" });
    await expect.poll(() => this.deleteButton.visible()).toBe(true);
  }

  async selectWire(index = 0, context = false): Promise<BrowserElement> {
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
    await this.page.mouse.click(midpoint.x, midpoint.y + 4, { button: context ? "right" : "left" });
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

test("targets the right-clicked block and dismisses its menu with Escape or an outside click", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  await diagram.block("ScopeF32").click();
  await diagram.openBlockMenu("ConstF32");
  expect(await diagram.block("ScopeF32").getAttribute("data-selected")).toBe("false");
  expect(await diagram.block("ConstF32").getAttribute("data-selected")).toBe("true");
  expect(await diagram.deleteButton.within('wa-icon[name="trash"]').count()).toBe(1);
  await expect.poll(() => diagram.deleteButton.within("wa-icon").shadow("svg").count()).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => diagram.deleteButton.visible()).toBe(false);
  expect(await diagram.canvas.within("[data-diagram-block]").count()).toBe(2);
  await diagram.openBlockMenu("ConstF32");
  await diagram.canvas.click({ position: { x: 700, y: 70 } });
  await expect.poll(() => diagram.deleteButton.visible()).toBe(false);
  await diagram.openBlockMenu("ConstF32");
  await page.keyboard.press("Enter");
  await expect.poll(() => diagram.block("ConstF32").count()).toBe(0);
  expect(await diagram.block("ScopeF32").count()).toBe(1);
});

test("touch-and-hold opens Delete while touch movement cancels the menu", async ({ page }) => {
  await page.setViewport({ width: 800, height: 600, hasTouch: true });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  await diagram.pair();
  const block = diagram.block("ConstF32");
  const before = await block.boundingBox();
  const client = await page.createCDPSession();
  const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await expect.poll(() => diagram.deleteButton.visible()).toBe(true);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => diagram.deleteButton.visible()).toBe(true);
  expect(await block.boundingBox()).toEqual(before);
  await page.screenshot({ path: artifactPath("touch-context-menu.png") });
  await page.keyboard.press("Escape");
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: point.x, y: point.y + 60 }] });
  await new Promise(resolve => setTimeout(resolve, 650));
  expect(await diagram.deleteButton.visible()).toBe(false);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await diagram.openBlockMenu("ConstF32");
  await diagram.deleteButton.click();
  await expect.poll(() => diagram.block("ConstF32").count()).toBe(0);
});

test("selects blocks and connections with a slow 17% fade and deletes a wire from its context menu", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const diagram = new SelectionDiagram(page);
  expect(await element(page, "[data-toolbar] [data-delete-selected]").count()).toBe(0);
  expect(await diagram.deleteButton.visible()).toBe(false);
  await diagram.pair();
  const constant = diagram.block("ConstF32");
  await constant.click();
  await expect.poll(() => constant.getAttribute("data-selected")).toBe("true");
  await expectPulse(constant);
  const wire = await diagram.selectWire(0, true);
  await expect.poll(() => constant.getAttribute("data-selected")).toBe("false");
  await expectPulse(wire);
  await page.screenshot({ path: artifactPath("selected-connection.png") });
  await diagram.deleteButton.click();
  await expect.poll(() => diagram.canvas.within("[data-connection]").count()).toBe(0);
  await expect.poll(() => diagram.canvas.within("[data-diagram-block]").count()).toBe(2);
  await expect.poll(() => diagram.deleteButton.visible()).toBe(false);
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
    await expect.poll(() => diagram.deleteButton.visible()).toBe(false);
    await diagram.block("ScopeF32").click();
    await expect.poll(() => element(page, "[data-scope-plot]").visible()).toBe(true);
    await diagram.openBlockMenu("ScopeF32");
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
  await expect.poll(() => diagram.deleteButton.visible()).toBe(false);

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
  await diagram.openBlockMenu("ConstF32");
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
  await diagram.openBlockMenu("ConstF32");
  await diagram.deleteButton.click();
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
