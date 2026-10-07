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

test("routes a connector around a block with the avoid router", async ({ page }) => {
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
  await expect(wire).toHaveAttribute("data-route-origin", "avoid");

  const geometry = await page.evaluate(() => {
    const canvasElement = document.querySelector("[data-diagram-canvas]");
    const obstacle = document.querySelector("[data-block-ref=SumF32]");
    const polyline = document.querySelector("[data-connection]");
    if (!(canvasElement instanceof HTMLElement) || !(obstacle instanceof HTMLElement) || !(polyline instanceof SVGPolylineElement)) {
      return undefined;
    }
    const origin = canvasElement.getBoundingClientRect();
    const box = obstacle.getBoundingClientRect();
    const points = [...polyline.points].map((point) => ({ x: point.x, y: point.y }));
    return {
      points,
      rect: {
        left: box.left - origin.left + 3,
        right: box.right - origin.left - 3,
        top: box.top - origin.top + 3,
        bottom: box.bottom - origin.top - 3,
      },
    };
  });
  expect(geometry).toBeTruthy();
  expect(geometry!.points.length).toBeGreaterThan(2);
  expect(segmentHitsRect(geometry!.points, geometry!.rect)).toBe(false);

  await page.screenshot({ path: test.info().outputPath("diagram-routed.png") });
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
