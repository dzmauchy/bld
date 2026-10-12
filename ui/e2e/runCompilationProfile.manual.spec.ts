import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test.skip(!process.env.MANUAL, "Set MANUAL=1 to profile the Run button.");

interface ProfileEvent {
  phase: string;
  name: string;
  started: number;
  durationMs?: number;
  bytes?: number;
  files?: number;
}

/** Test-only timing probes around native worker/tool operations; no production changes. */
function installRunProfiler(): void {
  const events: ProfileEvent[] = [];
  const now = () => performance.timeOrigin + performance.now();
  (window as unknown as { runProfile: ProfileEvent[] }).runProfile = events;
  function probeWorker(): void {
    const send = self.postMessage.bind(self);
    const now = () => performance.timeOrigin + performance.now();
    const record = (event: ProfileEvent) => send({ type: "run-profile", event });
    const buffers = new WeakMap<ArrayBuffer, string>();
    const modules = new WeakMap<WebAssembly.Module, string>();
    const responses = new WeakMap<Response, { name: string; started: number }>();
    const fetchOriginal = self.fetch.bind(self);
    self.fetch = async (...args) => {
      const started = now();
      const response = await fetchOriginal(...args);
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      const name = url.split("/").at(-1)!;
      responses.set(response, { name, started });
      return response;
    };
    const arrayBufferOriginal = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function () {
      const buffer = await arrayBufferOriginal.call(this);
      const response = responses.get(this);
      if (response) {
        buffers.set(buffer, response.name);
        record({ phase: "asset", name: response.name, started: response.started, durationMs: now() - response.started, bytes: buffer.byteLength });
        if (/^(clang|lld)\.js$/.test(response.name)) {
          const source = new TextDecoder().decode(buffer);
          const exported = source.match(/export\s+default\s+([\w$]+)\s*;/);
          if (exported) {
            const instrumented = source.replace(exported[0], `
              const __bldProfileFactory = async (...options) => {
                const runtime = await ${exported[1]}(...options);
                const main = runtime.callMain.bind(runtime);
                runtime.callMain = (...args) => {
                  const started = performance.timeOrigin + performance.now();
                  try { return main(...args); }
                  finally { self.postMessage({type: "run-profile", event: {
                    phase: "tool-main", name: ${JSON.stringify(response.name)}, started,
                    durationMs: performance.timeOrigin + performance.now() - started
                  }}); }
                };
                return runtime;
              };
              export default __bldProfileFactory;`);
            return new TextEncoder().encode(instrumented).buffer;
          }
        }
      }
      return buffer;
    };
    const compileOriginal = WebAssembly.compile;
    WebAssembly.compile = async (bytes, ...options) => {
      const started = now();
      const module = await compileOriginal(bytes, ...options);
      const buffer = ArrayBuffer.isView(bytes) ? bytes.buffer : bytes;
      const name = buffers.get(buffer as ArrayBuffer) ?? "diagram.wasm";
      modules.set(module, name);
      record({ phase: "wasm-module", name, started, durationMs: now() - started });
      return module;
    };
    WebAssembly.Instance = new Proxy(WebAssembly.Instance, {
      construct(Instance, args) {
        const started = now();
        const instance = Reflect.construct(Instance, args) as WebAssembly.Instance;
        const name = modules.get(args[0]) ?? "diagram.wasm";
        record({ phase: "wasm-instance", name, started, durationMs: now() - started });
        return instance;
      },
    });
  }
  const WorkerOriginal = window.Worker;
  window.Worker = class extends WorkerOriginal {
    private readonly pending = new Map<number, { name: string; started: number }>();

    constructor(url: string | URL, options?: WorkerOptions) {
      const address = new URL(String(url), location.href).href;
      const bootstrap = new Blob([`(${probeWorker.toString()})();
        const earlyMessages = [];
        const queueMessage = event => { earlyMessages.push(event.data); event.stopImmediatePropagation(); };
        self.addEventListener('message', queueMessage);
        await import(${JSON.stringify(address)});
        self.removeEventListener('message', queueMessage);
        for (const data of earlyMessages) self.dispatchEvent(new MessageEvent('message', { data }));`], { type: "text/javascript" });
      const blob = URL.createObjectURL(bootstrap);
      super(blob, { ...options, type: "module" });
      events.push({ phase: "worker-created", name: address, started: now() });
      this.addEventListener("message", (message) => {
        if (message.data?.type === "run-profile") {
          events.push(message.data.event);
          message.stopImmediatePropagation();
          return;
        }
        const pending = this.pending.get(message.data?.id);
        if (!pending) return;
        this.pending.delete(message.data.id);
        events.push({ phase: "worker-request", ...pending, durationMs: now() - pending.started });
      });
    }

    override postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
      const request = message as { type?: string; id?: number; files?: Record<string, string> };
      if (request.id !== undefined && ["init", "compile", "instantiate"].includes(request.type ?? "")) {
        this.pending.set(request.id, { name: request.type!, started: now() });
        if (request.files) events.push({ phase: "source-payload", name: request.type!, started: now(),
          files: Object.keys(request.files).length, bytes: Object.values(request.files).reduce((sum, text) => sum + text.length, 0) });
      }
      if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
      else super.postMessage(message, transferOrOptions);
    }
  };
  document.addEventListener("click", (event) => {
    const button = (event.target as Element)?.closest("[data-run-toggle]");
    if (button?.getAttribute("data-run-state") === "idle") events.push({ phase: "run-click", name: "Run", started: now() });
  }, true);
  const observer = new MutationObserver(() => {
    const button = document.querySelector("[data-run-toggle]");
    if (button?.getAttribute("data-run-state") === "running") {
      const click = events.findLast((event) => event.phase === "run-click");
      if (click && !events.some((event) => event.phase === "running" && event.started >= click.started)) {
        events.push({ phase: "running", name: "Run to running", started: now(), durationMs: now() - click.started });
      }
    }
  });
  observer.observe(document, { subtree: true, attributes: true, attributeFilter: ["data-run-state"] });
}

test("profiles the actual Run button on cold, unchanged, and edited diagrams", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(installRunProfiler);
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const canvas = page.locator("[data-diagram-canvas]");
  for (const [ref, x, y] of [
    ["ScopeF32", 130, 200], ["SumF32", 380, 200], ["ConstF32", 640, 90], ["SinGenF32", 640, 310],
  ] as const) {
    const source = page.locator(`[data-block-id=${ref}]`);
    await source.scrollIntoViewIfNeeded();
    await source.click();
    await canvas.click({ position: { x, y } });
  }
  for (const [from, to] of [["ScopeF32", "SumF32"], ["SumF32", "ConstF32"], ["SumF32", "SinGenF32"]]) {
    const output = await canvas.locator(`[data-block-ref=${from}] [data-port-side=output]`).boundingBox();
    const input = await canvas.locator(`[data-block-ref=${to}] [data-port-side=input]`).boundingBox();
    await page.mouse.move(output!.x + output!.width / 2, output!.y + output!.height / 2);
    await page.mouse.down();
    await page.mouse.move(input!.x + input!.width / 2, input!.y + input!.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await expect(canvas.locator("[data-connection]")).toHaveCount(3);
  await canvas.locator("[data-block-ref=ScopeF32]").click();
  const run = page.locator("[data-run-toggle]");
  const results: { name: string; events: ProfileEvent[] }[] = [];
  for (const name of ["cold", "unchanged", "edited"]) {
    if (name === "edited") {
      await canvas.locator("[data-block-ref=ConstF32] [data-block-config]").click();
      const input = page.locator("[data-block-config-dialog] [data-config-field=value] input");
      await input.fill("2");
      await input.press("Enter");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Constant", exact: true })).toBeHidden();
    }
    const first = await page.evaluate(() => (window as unknown as { runProfile: ProfileEvent[] }).runProfile.length);
    await run.click();
    await expect(run).toHaveAttribute("data-run-state", "running", { timeout: 180_000 });
    await expect(page.locator("[data-run-status]")).toHaveText("");
    const events = await page.evaluate((first) => (window as unknown as { runProfile: ProfileEvent[] }).runProfile.slice(first), first);
    results.push({ name, events });
    console.log(`RUN PROFILE ${name}: ${JSON.stringify(events.filter((event) => ["running", "worker-request", "tool-main", "asset"].includes(event.phase)))}`);
    await run.click();
    await expect(run).toHaveAttribute("data-run-state", "idle");
  }
  const allEvents = await page.evaluate(() => (window as unknown as { runProfile: ProfileEvent[] }).runProfile);
  const firstClick = allEvents.find((event) => event.phase === "run-click")!;
  const preparation = allEvents.filter((event) => event.started < firstClick.started);
  console.log(`STARTUP PROFILE: ${JSON.stringify(preparation)}`);
  const report = JSON.stringify({ preparation, runs: results }, null, 2);
  await writeFile(test.info().outputPath("run-compilation-profile.json"), report);
  await test.info().attach("Run compilation profile", { body: report, contentType: "application/json" });
  expect(results.every((result) => result.events.some((event) => event.phase === "running"))).toBe(true);
  expect(results[0]!.events.some((event) => event.phase === "tool-main" && event.name === "clang.js")).toBe(true);
  expect(results[1]!.events.some((event) => event.phase === "tool-main" && event.name === "clang.js")).toBe(false);
  expect(results[2]!.events.some((event) => event.phase === "tool-main" && event.name === "clang.js")).toBe(true);
  for (const name of ["clang.wasm", "lld.wasm"]) {
    const modules = allEvents.filter((event) => event.phase === "wasm-module" && event.name === name);
    expect(modules).toHaveLength(1);
    expect(modules[0]!.started).toBeLessThan(firstClick.started);
  }
  expect(allEvents.filter((event) => event.phase === "worker-request" && event.name === "init")).toHaveLength(1);
});
