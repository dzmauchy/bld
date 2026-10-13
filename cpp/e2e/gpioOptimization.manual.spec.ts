import { readFileSync, writeFileSync } from "node:fs";
import { beforeAll } from "vitest";
import type { CDPSession } from "puppeteer";
import { CppDiagramBuilder, Diagram, Library, PortEndpoint } from "core";
import { artifactPath, baseURL, browserTest, expect } from "../../tests/e2e/browser.ts";

const test = browserTest();
let builder: CppDiagramBuilder;
let palette: Library["palette"];

beforeAll(async () => {
  const manifest = JSON.parse(readFileSync(new URL("../../core/assets/base.json", import.meta.url), "utf8"));
  const library = await Library.load(manifest);
  builder = new CppDiagramBuilder(library.compilationModel.getFiles());
  palette = library.palette;
});

for (const variant of ["pragma", "original", "bounded-search", "direct-index", "scalar-search"] as const) {
  test(`GPIO optimization investigation: ${variant}`, async ({ page }) => {
    await page.goto(baseURL());
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "module-ready");
    const diagram = new Diagram("gpio", "GPIO optimization", palette);
    diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "scope");
    diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "gpio", { port: 7, pins: [1, 3] });
    for (const channel of [0, 1]) diagram.connect(
      new PortEndpoint("scope", "output", "channels", channel),
      new PortEndpoint("gpio", "input", "pins", channel),
    );
    const files = builder.build(diagram);
    if (variant === "pragma") files.set("diagram.cpp",
      '#include <core/hal.hpp>\n#pragma clang optimize off\n#include <base/gpio_in.hpp>\n#pragma clang optimize on\n'
      + files.get("diagram.cpp")!);
    const gpio = files.get("base/gpio_in.hpp")!;
    if (variant === "bounded-search") files.set("base/gpio_in.hpp", gpio.replace("while (pins[index] != pin)", "while (index < i && pins[index] != pin)"));
    if (variant === "direct-index") files.set("base/gpio_in.hpp", gpio.replace(/u32\s+index = 0;\s+while \(pins\[index\] != pin\)\s+\+\+index;/, "const u32 index = i;"));
    if (variant === "scalar-search") files.set("base/gpio_in.hpp", gpio.replace("while (pins[index] != pin)", "#pragma clang loop vectorize(disable) interleave(disable)\n    while (pins[index] != pin)"));
    writeFileSync(artifactPath("diagram.cpp"), files.get("diagram.cpp")!);
    writeFileSync(artifactPath("gpio_in.hpp"), files.get("base/gpio_in.hpp")!);
    let profiler: CDPSession | undefined;
    let attached: Promise<void> | undefined;
    page.on("workercreated", (worker) => {
      if (!worker.url().includes("compiler.worker")) return;
      attached = (async () => {
        profiler = worker.client;
        await profiler.send("Profiler.enable");
        await profiler.send("Profiler.start");
      })();
    });
    await page.evaluate((files) => {
      const trial = { status: "running", durationMs: 0, bytes: 0, values: [] as number[], error: "" };
      Object.assign(window, { gpioTrial: trial });
      const start = performance.now();
      void window.cpp.compile(files).then(async (bytes) => {
        trial.bytes = bytes;
        await window.cpp.invoke("emitGpioIn", [1, 0, 1]);
        await window.cpp.invoke("emitGpioIn", [1, 1, 0]);
        trial.values = [await window.cpp.invoke("lastPin", [0, 0]), await window.cpp.invoke("lastPin", [0, 1])];
        trial.status = "completed";
      }).catch((error: unknown) => {
        trial.status = "failed";
        trial.error = String(error);
      }).finally(() => { trial.durationMs = performance.now() - start; });
    }, Object.fromEntries(files));
    await page.waitForFunction(() => (window as unknown as { gpioTrial: { status: string } }).gpioTrial.status !== "running",
      { timeout: 15_000 }).catch(() => {});
    await attached;
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      writeFileSync(artifactPath("compiler.cpuprofile"), JSON.stringify(profile));
      const counts = new Map<number, number>();
      for (const id of profile.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
      console.log(variant, "hot frames", profile.nodes.filter((node) => counts.has(node.id))
        .sort((a, b) => counts.get(b.id)! - counts.get(a.id)!).slice(0, 6)
        .map((node) => ({ frame: node.callFrame.functionName, samples: counts.get(node.id) })));
    }
    const result = await page.evaluate(() => (window as unknown as {
      gpioTrial: { status: string; values: number[]; error: string };
    }).gpioTrial);
    writeFileSync(artifactPath("result.json"), JSON.stringify(result, null, 2));
    console.log(variant, result);
    expect(result.status, result.error || "Compiler did not finish within 15 seconds").toBe("completed");
    expect(result.values).toEqual([1, 0]);
  });
}
