import { expect, test } from "@playwright/test";

test("drags a palette block, arms another with a fade blink, and inserts it on a canvas click", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const palette = page.locator("[data-region=palette]");
  const canvas = page.locator("[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  const constant = palette.locator("[data-block-id=ConstF32]");
  await constant.scrollIntoViewIfNeeded();
  const sourceBox = await constant.boundingBox();
  expect(sourceBox).toBeTruthy();
  const dropX = canvasBox!.x + 140;
  const dropY = canvasBox!.y + 150;
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dropX, dropY, { steps: 12 });
  await expect(page.locator(".palette-drag-ghost")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".palette-drag-ghost")).toHaveCount(0);

  const dropped = canvas.locator("[data-block-ref=ConstF32]");
  await expect(dropped).toHaveCount(1);
  const droppedBox = await dropped.boundingBox();
  expect(droppedBox).toBeTruthy();
  expect(Math.abs(droppedBox!.x + droppedBox!.width / 2 - dropX)).toBeLessThan(2);
  expect(Math.abs(droppedBox!.y + droppedBox!.height / 2 - dropY)).toBeLessThan(2);
  await expect(constant).toHaveAttribute("data-armed", "false");

  const scope = palette.locator("[data-block-id=ScopeF32]");
  await scope.scrollIntoViewIfNeeded();
  await scope.click();
  await expect(scope).toHaveAttribute("data-armed", "true");
  await expect(scope).toHaveAttribute("aria-pressed", "true");
  const blink = await scope.evaluate(async (element) => {
    const style = getComputedStyle(element);
    const samples: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      samples.push(Number(getComputedStyle(element).opacity));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { name: style.animationName, samples };
  });
  expect(blink.name).toBe("palette-fade-blink");
  expect(Math.max(...blink.samples) - Math.min(...blink.samples)).toBeGreaterThan(0.2);
  await expect(canvas.locator("[data-block-ref=ScopeF32]")).toHaveCount(0);

  await canvas.click({ position: { x: 280, y: 120 } });
  const stamped = canvas.locator("[data-block-ref=ScopeF32]");
  await expect(stamped).toHaveCount(1);
  const stampedBox = await stamped.boundingBox();
  expect(stampedBox).toBeTruthy();
  expect(Math.abs(stampedBox!.x + stampedBox!.width / 2 - (canvasBox!.x + 280))).toBeLessThan(2);
  expect(Math.abs(stampedBox!.y + stampedBox!.height / 2 - (canvasBox!.y + 120))).toBeLessThan(2);
  await expect(scope).toHaveAttribute("data-armed", "true");

  await canvas.click({ position: { x: 280, y: 260 } });
  await expect(stamped).toHaveCount(2);
  await scope.click();
  await expect(scope).toHaveAttribute("data-armed", "false");
  await canvas.click({ position: { x: 420, y: 80 } });
  await expect(stamped).toHaveCount(2);
});

test("routes a connector around a block with maxGraph", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const wasmRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(".wasm")) wasmRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
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
    await page.mouse.move(clientX, clientY, { steps: 14 });
    await page.mouse.up();
    await expect(canvas.locator(`[data-block-ref=${blockId}]`)).toHaveCount(1);
  }

  const y = canvasBox!.y + 180;
  await drop("ScopeF32", canvasBox!.x + 110, y);
  await drop("SumF32", canvasBox!.x + 330, y);
  await drop("ConstF32", canvasBox!.x + 550, y);

  const output = canvas.locator("[data-block-ref=ScopeF32] [data-port-side=output]");
  const input = canvas.locator("[data-block-ref=ConstF32] [data-port-side=input]");
  const outputBox = await output.boundingBox();
  const inputBox = await input.boundingBox();
  expect(outputBox).toBeTruthy();
  expect(inputBox).toBeTruthy();
  await page.mouse.move(outputBox!.x + outputBox!.width / 2, outputBox!.y + outputBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(inputBox!.x + inputBox!.width / 2, inputBox!.y + inputBox!.height / 2, { steps: 16 });
  await expect(canvas.locator(".diagram-wire.is-draft")).toBeVisible();
  await page.mouse.up();

  const wire = canvas.locator("[data-connection]");
  await expect(wire).toHaveCount(1);
  await expect(wire).toHaveAttribute("data-route-origin", "maxgraph");

  const readGeometry = () => page.evaluate(() => {
    const canvasElement = document.querySelector("[data-diagram-canvas]");
    const obstacle = document.querySelector("[data-block-ref=SumF32]");
    const polyline = document.querySelector("[data-connection]");
    if (!(canvasElement instanceof HTMLElement) || !(obstacle instanceof HTMLElement) || !(polyline instanceof SVGPolylineElement)) {
      return undefined;
    }
    const origin = canvasElement.getBoundingClientRect();
    const box = obstacle.getBoundingClientRect();
    const points = [...polyline.points].map((point) => ({ x: point.x, y: point.y }));
    const anchors = [
      document.querySelector("[data-block-ref=ScopeF32] [data-port-side=output]"),
      document.querySelector("[data-block-ref=ConstF32] [data-port-side=input]"),
    ].map((element) => {
      const rect = element!.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - origin.left, y: rect.top + rect.height / 2 - origin.top };
    });
    return {
      points,
      anchors,
      rect: {
        left: box.left - origin.left + 3,
        right: box.right - origin.left - 3,
        top: box.top - origin.top + 3,
        bottom: box.bottom - origin.top - 3,
      },
    };
  });
  async function expectRoute(): Promise<void> {
    const geometry = await readGeometry();
    expect(geometry).toBeTruthy();
    expect(segmentHitsRect(geometry!.points, geometry!.rect)).toBe(false);
    for (let index = 1; index < geometry!.points.length; index++) {
      const from = geometry!.points[index - 1];
      const to = geometry!.points[index];
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
    for (const [point, anchor] of [
      [geometry!.points[0], geometry!.anchors[0]],
      [geometry!.points.at(-1)!, geometry!.anchors[1]],
    ]) {
      // The block border offsets the visual port center by one CSS pixel.
      expect(Math.abs(point.x - anchor.x)).toBeLessThan(2);
      expect(Math.abs(point.y - anchor.y)).toBeLessThan(2);
    }
  }
  expect((await readGeometry())!.points.length).toBeGreaterThan(2);
  await expectRoute();

  await page.screenshot({ path: test.info().outputPath("diagram-routed.png") });

  async function move(blockRef: string, dx: number, dy: number): Promise<void> {
    const box = (await canvas.locator(`[data-block-ref=${blockRef}]`).boundingBox())!;
    const previous = await wire.getAttribute("points");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => wire.getAttribute("points")).not.toBe(previous);
    await expectRoute();
  }

  // Reroute for a moved obstacle, a moved terminal, and a moved target.
  await move("SumF32", 0, 140);
  await move("ScopeF32", 0, -60);
  await move("ConstF32", 0, 70);
  expect(wasmRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("draws each multiplexed connection on its own lane and grows that port", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
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
    await expect(canvas.locator(`[data-block-ref=${blockId}]`)).toHaveCount(1);
  }

  async function connect(fromRef: string, fromSide: "input" | "output", toRef: string, toSide: "input" | "output"): Promise<void> {
    const from = canvas.locator(`[data-block-ref=${fromRef}] [data-port-side=${fromSide}]`);
    const to = canvas.locator(`[data-block-ref=${toRef}] [data-port-side=${toSide}]`);
    const fromBox = await from.boundingBox();
    const toBox = await to.boundingBox();
    expect(fromBox).toBeTruthy();
    expect(toBox).toBeTruthy();
    await page.mouse.move(fromBox!.x + fromBox!.width / 2, fromBox!.y + fromBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(toBox!.x + toBox!.width / 2, toBox!.y + toBox!.height / 2, { steps: 16 });
    await page.mouse.up();
  }

  const y = canvasBox!.y + 220;
  await drop("ScopeF32", canvasBox!.x + 160, y);
  await drop("SumF32", canvasBox!.x + 420, y);
  await drop("ConstF32", canvasBox!.x + 700, y - 120);
  await drop("SinF32", canvasBox!.x + 700, y + 120);

  await connect("ScopeF32", "output", "SumF32", "input");
  await expect(canvas.locator("[data-connection]")).toHaveCount(1);
  await connect("SumF32", "output", "ConstF32", "input");
  const output = canvas.locator("[data-block-ref=SumF32] [data-port-side=output]");
  await expect(output).toHaveAttribute("data-port-lanes", "1");
  const before = await output.boundingBox();
  await connect("SumF32", "output", "SinF32", "input");
  await expect(canvas.locator("[data-connection]")).toHaveCount(3);
  await expect(output).toHaveAttribute("data-port-lanes", "2");
  await expect(canvas.locator("[data-block-ref=SumF32] [data-port-side=input]")).toHaveAttribute("data-port-lanes", "1");
  await expect(canvas.locator("[data-block-ref=ConstF32] [data-port-side=input]")).toHaveAttribute("data-port-lanes", "1");
  await expect(canvas.locator("[data-block-ref=SinF32] [data-port-side=input]")).toHaveAttribute("data-port-lanes", "1");
  const after = await output.boundingBox();
  expect(before && after && after.height).toBeGreaterThan((before?.height ?? 0) + 8);
  await expect(canvas.locator("[data-route-origin=maxgraph]")).toHaveCount(3);

  const lanes = await page.evaluate(() => {
    const canvasElement = document.querySelector("[data-diagram-canvas]");
    const port = document.querySelector("[data-block-ref=SumF32] [data-port-side=output]");
    if (!(canvasElement instanceof HTMLElement) || !(port instanceof HTMLElement)) return undefined;
    const origin = canvasElement.getBoundingClientRect();
    const pins = [...port.querySelectorAll("[data-port-pin]")].map((pin) => {
      const rect = pin.getBoundingClientRect();
      return {
        index: pin.getAttribute("data-vector-index"),
        y: rect.top + rect.height / 2 - origin.top,
      };
    });
    const wires = [...document.querySelectorAll("[data-connection]")].map((wire) => {
      const points = [...(wire as SVGPolylineElement).points].map((point) => ({ x: point.x, y: point.y }));
      return { id: wire.getAttribute("data-connection"), points };
    });
    return { pins, wires, lanes: port.getAttribute("data-port-lanes") };
  });
  expect(lanes?.lanes).toBe("2");
  expect(lanes?.pins.map((pin) => pin.y)).toHaveLength(2);
  expect(Math.abs((lanes?.pins[1]?.y ?? 0) - (lanes?.pins[0]?.y ?? 0))).toBeGreaterThan(12);
  const departures = (lanes?.wires ?? []).flatMap((wire) => {
    const start = wire.points[0];
    if (!start) return [];
    const pin = lanes?.pins.find((candidate) => Math.abs(candidate.y - start.y) < 4);
    return pin ? [{ id: wire.id, y: start.y }] : [];
  });
  expect(departures).toHaveLength(2);
  expect(new Set(departures.map((wire) => Math.round(wire.y))).size).toBe(2);

  const contentFit = await canvas.locator("[data-diagram-block]").evaluateAll((blocks) => blocks.map((block) => {
    const label = block.querySelector(".diagram-block-title") as HTMLElement;
    return {
      ref: block.getAttribute("data-block-ref"),
      width: block.getBoundingClientRect().width,
      clipped: label.scrollWidth - label.clientWidth,
    };
  }));
  for (const block of contentFit) {
    expect(block.width).toBeLessThan(100);
    expect(block.clipped).toBeLessThanOrEqual(1);
  }
  expect(contentFit.find((block) => block.ref === "SinF32")!.width).toBeLessThan(contentFit.find((block) => block.ref === "ConstF32")!.width);
  await page.screenshot({ path: test.info().outputPath("multiplexed-ports.png") });
});

test("opens a configuration dialog from the gear on a block that has parameters", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const palette = page.locator("[data-region=palette]");
  const canvas = page.locator("[data-diagram-canvas]");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();

  const constant = palette.locator("[data-block-id=ConstF32]");
  await constant.scrollIntoViewIfNeeded();
  const sourceBox = await constant.boundingBox();
  expect(sourceBox).toBeTruthy();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 240, canvasBox!.y + 160, { steps: 12 });
  await page.mouse.up();

  const cosine = palette.locator("[data-block-id=CosF32]");
  await cosine.scrollIntoViewIfNeeded();
  const cosineBox = await cosine.boundingBox();
  expect(cosineBox).toBeTruthy();
  await page.mouse.move(cosineBox!.x + cosineBox!.width / 2, cosineBox!.y + cosineBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 480, canvasBox!.y + 160, { steps: 12 });
  await page.mouse.up();

  await expect(canvas.locator("[data-block-ref=ConstF32] [data-block-config]")).toHaveCount(1);
  await expect(canvas.locator("[data-block-ref=CosF32] [data-block-config]")).toHaveCount(0);
  await canvas.locator("[data-block-ref=ConstF32] [data-block-config]").click();
  const dialog = page.getByRole("dialog", { name: "Constant" });
  await expect(dialog).toBeVisible();
  const value = page.locator("[data-block-config-dialog] [data-config-field=value] input");
  await expect(value).toBeVisible();
  await expect(value).toHaveValue("1");
  await value.fill("3.25");
  await value.press("Enter");
  await expect(value).toHaveValue("3.25");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await canvas.locator("[data-block-ref=ConstF32] [data-block-config]").click();
  await expect(page.locator("[data-block-config-dialog] [data-config-field=value] input")).toHaveValue("3.25");
});

function segmentHitsRect(
  points: { x: number; y: number }[],
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    if (hits(from, to, rect)) return true;
  }
  return false;
}

function hits(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: { left: number; right: number; top: number; bottom: number },
): boolean {
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const bottom = Math.max(from.y, to.y);
  const horizontal = Math.abs(from.y - to.y) < 0.5;
  const vertical = Math.abs(from.x - to.x) < 0.5;
  if (horizontal) {
    return from.y > rect.top && from.y < rect.bottom && right > rect.left && left < rect.right;
  }
  if (vertical) {
    return from.x > rect.left && from.x < rect.right && bottom > rect.top && top < rect.bottom;
  }
  return false;
}
