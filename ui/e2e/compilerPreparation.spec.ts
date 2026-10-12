import { expect, test } from "@playwright/test";

interface PreparationProbe {
  requests: string[];
  release(): void;
}

test("prepares the compiler at startup and shares its pending promise with Run", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const pending: (() => void)[] = [];
    const probe: PreparationProbe = {
      requests: [],
      release() { pending.splice(0).forEach((send) => send()); },
    };
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe = probe;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        const type = (message as { type?: string })?.type;
        if (type) probe.requests.push(type);
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        };
        // Hold preparation so Run has to await the startup promise.
        if (type === "init") pending.push(send);
        else send();
      }
    };
  });
  const requests = () => page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.requests);

  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  expect(await requests()).toEqual(["init"]);

  // The workspace remains editable while compiler preparation is pending.
  const canvas = page.locator("[data-diagram-canvas]");
  for (const [ref, x] of [["ScopeF32", 140], ["ConstF32", 420]] as const) {
    const block = page.locator(`[data-block-id=${ref}]`);
    await block.scrollIntoViewIfNeeded();
    await block.click();
    await canvas.click({ position: { x, y: 180 } });
    await expect(canvas.locator(`[data-block-ref=${ref}]`)).toHaveCount(1);
  }
  const output = await canvas.locator("[data-block-ref=ScopeF32] [data-port-side=output]").boundingBox();
  const input = await canvas.locator("[data-block-ref=ConstF32] [data-port-side=input]").boundingBox();
  await page.mouse.click(output!.x + output!.width / 2, output!.y + output!.height / 2);
  await page.mouse.click(input!.x + input!.width / 2, input!.y + input!.height / 2);
  await expect(canvas.locator("[data-connection]")).toHaveCount(1);

  const run = page.locator("[data-run-toggle]");
  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "starting");
  expect(await requests()).toEqual(["init"]);
  await page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.release());
  await expect(run).toHaveAttribute("data-run-state", "running");
  await expect(page.locator("[data-run-status]")).toHaveText("");
  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "idle");
  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "running");
  expect((await requests()).filter((type) => type === "init")).toHaveLength(1);
  expect((await requests()).filter((type) => type === "compile")).toHaveLength(2);
  await run.click();
  await expect(run).toHaveAttribute("data-run-state", "idle");
  expect(errors).toEqual([]);
});
