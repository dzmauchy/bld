import { closePalette, openPalette, expect, test, element, baseURL, dialog, artifactPath } from "./fixtures/browser.ts";

interface PreparationProbe {
  requests: string[];
  release(): void;
  resume(): void;
}

test("prepares the compiler at startup and shares its pending promise with Run", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error instanceof Error ? error.message : String(error)));
  await page.evaluateOnNewDocument(() => {
    const pending: (() => void)[] = [];
    const workers: { releaseMessages(): void }[] = [];
    let gated = true;
    const probe: PreparationProbe = {
      requests: [],
      release() {
        pending.splice(0).forEach((send) => send());
        workers.forEach(worker => worker.releaseMessages());
      },
      resume() { gated = false; this.release(); },
    };
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe = probe;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      private readonly held: MessageEvent[] = [];
      private paused = false;
      private forwarding = false;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        workers.push(this);
        // Let each phase start, then hold later messages until its UI is inspected.
        super.addEventListener("message", event => {
          if (this.forwarding || !gated) return;
          if (this.paused) {
            event.stopImmediatePropagation();
            this.held.push(event);
          } else if (event.data.type === "progress" && event.data.progress.status === "active") {
            this.paused = true;
          }
        });
      }

      releaseMessages(): void {
        this.paused = false;
        while (this.held.length && !this.paused) {
          const event = this.held.shift()!;
          this.forwarding = true;
          if (gated && event.data.type === "progress" && event.data.progress.status === "active") {
            this.paused = true;
          }
          this.dispatchEvent(new MessageEvent("message", { data: event.data }));
          this.forwarding = false;
        }
      }

      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        const type = (message as { type?: string })?.type;
        if (type) probe.requests.push(type);
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        };
        // Hold preparation so Run has to await the startup promise.
        if (gated && (type === "init" || type === "instantiate")) pending.push(send);
        else send();
      }
    };
  });
  const requests = () => page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.requests);

  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  expect(await requests()).toEqual(["init"]);

  // The workspace remains editable while compiler preparation is pending.
  const canvas = element(page, "[data-diagram-canvas]");
  for (const [ref, x] of [["ScopeF32", 140], ["ConstF32", 420]] as const) {
    const block = element(page, `[data-block-id=${ref}]`);
    await openPalette(page);
    await block.scrollIntoViewIfNeeded();
    await block.click();
    await closePalette(page);
    await canvas.click({ position: { x, y: 180 } });
    await expect.poll(() => canvas.within(`[data-block-ref=${ref}]`).count()).toBe(1);
  }
  const output = await canvas.within("[data-block-ref=ScopeF32] [data-port-side=output]").boundingBox();
  const input = await canvas.within("[data-block-ref=ConstF32] [data-port-side=input]").boundingBox();
  await page.mouse.click(output!.x + output!.width / 2, output!.y + output!.height / 2);
  await page.mouse.click(input!.x + input!.width / 2, input!.y + input!.height / 2);
  await expect.poll(() => canvas.within("[data-connection]").count()).toBe(1);

  const run = element(page, "[data-run-toggle]");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("starting");
  const blocker = dialog(page, "Compiling diagram");
  await expect.poll(() => blocker.visible()).toBe(true);
  const phases = ["awaiting-modules", "compilation", "linking", "running"];
  const step = (phase: string) => element(page, `[data-compile-step=${phase}]`);
  const states = () => Promise.all(phases.map(phase => step(phase).getAttribute("data-step-status")));
  await expect.poll(states).toEqual(["active", "pending", "pending", "pending"]);
  expect(await step("awaiting-modules").evaluate(node => getComputedStyle(node).animationName)).toBe("compilation-step-blink");
  expect(await element(page, ".workspace-shell").getAttribute("inert")).toBe("");
  await page.keyboard.press("Escape");
  await page.mouse.click(28, 24);
  expect(await blocker.visible()).toBe(true);
  expect(await element(page, "[data-palette-toggle]").getAttribute("aria-expanded")).toBe("false");
  await page.screenshot({ path: artifactPath("compiling-dialog.png") });
  expect(await requests()).toEqual(["init"]);
  await page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.release());
  await expect.poll(states).toEqual(["completed", "active", "pending", "pending"]);
  expect(await step("awaiting-modules").within("svg path").count()).toBe(1);
  expect(await step("compilation").getAttribute("aria-current")).toBe("step");
  await page.screenshot({ path: artifactPath("compilation-steps.png") });
  await page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.release());
  await expect.poll(states).toEqual(["completed", "completed", "active", "pending"]);
  await page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.release());
  await expect.poll(states).toEqual(["completed", "completed", "completed", "active"]);
  expect(await blocker.visible()).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { preparationProbe: PreparationProbe }).preparationProbe.resume());
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  await expect.poll(() => blocker.visible()).toBe(false);
  await expect.poll(() => element(page, "[data-run-status]").text()).toBe("");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect((await requests()).filter((type) => type === "init")).toHaveLength(1);
  expect((await requests()).filter((type) => type === "compile")).toHaveLength(2);
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  expect(errors).toEqual([]);
});
