import { closePalette, openPalette, expect, test, element, baseURL } from "./fixtures/browser.ts";

interface ColdCompileProbe {
  attempts: number;
  aborts: number;
  release(): void;
}

test("recovers from a module compilation abort while the first Run awaits preparation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.evaluateOnNewDocument(() => {
    const pending: (() => void)[] = [];
    let released = false;
    const probe: ColdCompileProbe = {
      attempts: 0, aborts: 0,
      release() { released = true; pending.splice(0).forEach(send => send()); },
    };
    (window as unknown as { coldCompileProbe: ColdCompileProbe }).coldCompileProbe = probe;
    function installAbort(): void {
      const compile = WebAssembly.compile;
      let first = true;
      WebAssembly.compile = async (...args) => {
        if (first) {
          first = false;
          self.postMessage({ type: "test-module-abort" });
          throw new WebAssembly.CompileError("WebAssembly.compile(): compilation aborted");
        }
        return compile(...args);
      };
    }
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        const address = new URL(String(url), location.href).href;
        if (!address.includes("compiler.worker")) { super(url, options); return; }
        const bootstrap = new Blob([`(${installAbort.toString()})();
          const pending = [];
          const hold = event => { pending.push(event.data); event.stopImmediatePropagation(); };
          self.addEventListener('message', hold);
          await import(${JSON.stringify(address)});
          self.removeEventListener('message', hold);
          for (const data of pending) self.dispatchEvent(new MessageEvent('message', { data }));`], { type: "text/javascript" });
        super(URL.createObjectURL(bootstrap), { ...options, type: "module" });
        this.addEventListener("message", event => {
          if (event.data?.type === "test-module-abort") {
            probe.aborts++;
            event.stopImmediatePropagation();
          }
        });
      }

      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void {
        const send = () => {
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        };
        if ((message as { type?: string })?.type === "init") {
          probe.attempts++;
          if (!released) { pending.push(send); return; }
        }
        send();
      }
    };
  });
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const canvas = element(page, "[data-diagram-canvas]");
  for (const [ref, x] of [["ScopeF32", 160], ["ConstF32", 420]] as const) {
    await openPalette(page);
    const source = element(page, `[data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    await source.click();
    await closePalette(page);
    await canvas.click({ position: { x, y: 180 } });
  }
  await canvas.within("[data-block-ref=ScopeF32] [data-port-side=output]").click();
  await canvas.within("[data-block-ref=ConstF32] [data-port-side=input]").click();
  const run = element(page, "[data-run-toggle]");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("starting");
  await page.evaluate(() => (window as unknown as { coldCompileProbe: ColdCompileProbe }).coldCompileProbe.release());
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect(await element(page, "[data-run-error]").count()).toBe(0);
  expect(await page.evaluate(() => {
    const probe = (window as unknown as { coldCompileProbe: ColdCompileProbe }).coldCompileProbe;
    return { attempts: probe.attempts, aborts: probe.aborts };
  })).toEqual({ attempts: 2, aborts: 1 });
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("idle");
  await run.click();
  await expect.poll(() => run.getAttribute("data-run-state")).toBe("running");
  expect(await page.evaluate(() => (window as unknown as { coldCompileProbe: ColdCompileProbe }).coldCompileProbe.attempts)).toBe(2);
  await run.click();
  expect(errors).toEqual([]);
});
