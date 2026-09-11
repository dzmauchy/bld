import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import "../../core/tests/nodeFileFetch.ts";
import { nativeLibraryFiles } from "../../base/src/index.ts";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  PortEndpoint,
  registerAppAssets,
} from "../../core/src/index.ts";
import "../../core/src/model/hostClangAstDumper.ts";
import type { CppPageApi } from "../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

test.describe.configure({ mode: "serial" });

const here = dirname(fileURLToPath(import.meta.url));
const coreAssets = join(here, "../../core/assets");
const nativeRoot = join(here, "../../base/native");

registerAppAssets({
  "base.json": readFileSync(join(coreAssets, "base.json"), "utf8"),
  "base/native/include/bld.hpp": readFileSync(join(nativeRoot, "include/bld.hpp"), "utf8"),
  "base/native/src/base.hpp": readFileSync(join(nativeRoot, "src/base.hpp"), "utf8"),
  "base/native/src/wasm_host.hpp": readFileSync(join(nativeRoot, "src/wasm_host.hpp"), "utf8"),
});

const builder = new CppDiagramBuilder(nativeLibraryFiles());
let page: Page;
let palette: Awaited<ReturnType<typeof Library.load>>["palette"];

function connect(diagram: Diagram, fromId: string, fromPort: string, fromVec: number, toId: string, toPort: string, toVec: number): void {
  const fromBlock = diagram.getBlock(fromId);
  const toBlock = diagram.getBlock(toId);
  if (!fromBlock || !toBlock) throw new Error("missing block");
  const fromType = fromBlock.definition.getOutput(fromPort) ? "output" : "input";
  const toType = toBlock.definition.getOutput(toPort) ? "output" : "input";
  diagram.connect(
    new PortEndpoint(fromId, fromType, fromPort, fromVec),
    new PortEndpoint(toId, toType, toPort, toVec),
  );
}

async function compileDiagram(diagram: Diagram): Promise<void> {
  const files = Object.fromEntries(builder.build(diagram));
  await page.evaluate(async (sourceFiles) => {
    await window.cpp.compile(sourceFiles);
  }, files);
}

async function invoke(name: string, args: number[] = []): Promise<number> {
  return page.evaluate(async ({ name, args }) => window.cpp.invoke(name, args), { name, args });
}

test.beforeAll(async ({ browser }) => {
  palette = (await Library.load("base.json")).palette;
  page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
});

test.afterAll(async () => {
  await page.close();
});

test("const_f32 writes to a scope channel", async () => {
  const diagram = new Diagram("const_scope", "const_scope", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("lastPin", [0, 0])).toBe(3.5);
  expect(await invoke("hasPin", [0, 0])).toBe(1);
});

test("const_f32 fans out across two scope channels", async () => {
  const diagram = new Diagram("fan", "fan", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 8 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  connect(diagram, "c", "v", 0, "s", "sink", 1);
  await compileDiagram(diagram);
  expect(await invoke("lastPin", [0, 0])).toBe(8);
  expect(await invoke("lastPin", [0, 1])).toBe(8);
});

test("independent scope channels stay independent", async () => {
  const diagram = new Diagram("indep", "indep", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "a", { v: 1.5 });
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "b", { v: 9.5 });
  connect(diagram, "a", "v", 0, "s", "sink", 0);
  connect(diagram, "b", "v", 0, "s", "sink", 1);
  await compileDiagram(diagram);
  expect(await invoke("lastPin", [0, 0])).toBe(1.5);
  expect(await invoke("lastPin", [0, 1])).toBe(9.5);
});

test("cos_f32 of zero is one", async () => {
  const diagram = new Diagram("cos", "cos", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("cos_f32", { x: 1, y: 0 }, "cs");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "z", { v: 0 });
  connect(diagram, "z", "v", 0, "cs", "v", 0);
  connect(diagram, "cs", "cos", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("lastPin", [0, 0])).toBe(1);
});

test("sin_f32 of zero is zero", async () => {
  const diagram = new Diagram("sin", "sin", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("sin_f32", { x: 1, y: 0 }, "sn");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "z", { v: 0 });
  connect(diagram, "z", "v", 0, "sn", "v", 0);
  connect(diagram, "sn", "sin", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("product of two constants appears on the scope after tick", async () => {
  const diagram = new Diagram("prod", "prod", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "p");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "p", "v", 0);
  connect(diagram, "b", "v", 0, "p", "v", 1);
  await compileDiagram(diagram);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(12);
});

test("sum of two constants appears on the scope after tick", async () => {
  const diagram = new Diagram("sum", "sum", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("sum_f32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "sum", "v", 0);
  connect(diagram, "b", "v", 0, "sum", "v", 1);
  await compileDiagram(diagram);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(7);
});

test("cos_gen_f32 at t=0 is one", async () => {
  const diagram = new Diagram("cgen", "cgen", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("cos_gen_f32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("setNow", [0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBeCloseTo(1, 5);
});

test("sin_gen_f32 at a quarter period is one", async () => {
  const diagram = new Diagram("sgen", "sgen", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("sin_gen_f32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("setNow", [250]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBeCloseTo(1, 3);
});

test("rand_gen_f32 uses injected random scaled by amplitude", async () => {
  const diagram = new Diagram("rand", "rand", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("rand_gen_f32", { x: 1, y: 0 }, "g", { amplitude: 2 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("setRandom", [0.25]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBeCloseTo(0.5, 5);
});

test("pulse_gen_f32 is high then low across the duty window", async () => {
  const diagram = new Diagram("pulse", "pulse", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("pulse_gen_f32", { x: 1, y: 0 }, "g", { duty_cycle: 0.5, frequency: 1 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("setNow", [0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(1);
  await invoke("setNow", [500]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("gpio_in_f32 true is one on the scope", async () => {
  const diagram = new Diagram("gpio_hi", "gpio_hi", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g", { pins: [0] });
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [1, 0, 1]);
  expect(await invoke("lastPin", [0, 0])).toBe(1);
});

test("gpio_in_f32 false is zero on the scope", async () => {
  const diagram = new Diagram("gpio_lo", "gpio_lo", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [1, 0, 0]);
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("gpio_in_f32 routes multiple pins onto independent scope channels", async () => {
  const diagram = new Diagram("gpio_multi", "gpio_multi", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g", { port: 7, pins: [1, 3] });
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  connect(diagram, "g", "pin", 1, "s", "sink", 1);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [1, 0, 1]);
  await invoke("emitGpioIn", [1, 1, 0]);
  expect(await invoke("lastPin", [0, 0])).toBe(1);
  expect(await invoke("lastPin", [0, 1])).toBe(0);
});

test("gpio_in_f32 close stops listening", async () => {
  const diagram = new Diagram("gpio_close", "gpio_close", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("activeGpioListenerCount")).toBe(1);
  await invoke("close");
  expect(await invoke("activeGpioListenerCount")).toBe(0);
  await invoke("clearPins");
  await invoke("emitGpioIn", [1, 0, 1]);
  expect(await invoke("hasPin", [0, 0])).toBe(0);
});

test("gpio pin through cos into scope", async () => {
  const diagram = new Diagram("gpio_cos", "gpio_cos", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("cos_f32", { x: 1, y: 0 }, "c");
  diagram.addBlock("gpio_in_f32", { x: 2, y: 0 }, "g", { pins: [0] });
  connect(diagram, "g", "pin", 0, "c", "v", 0);
  connect(diagram, "c", "cos", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [2, 0, 0]);
  expect(await invoke("lastPin", [0, 0])).toBe(1);
});

test("gpio AND via product", async () => {
  const diagram = new Diagram("gpio_and", "gpio_and", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "p");
  diagram.addBlock("gpio_in_f32", { x: 2, y: 0 }, "g", { pins: [0, 1] });
  connect(diagram, "g", "pin", 0, "p", "v", 0);
  connect(diagram, "g", "pin", 1, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [2, 0, 1]);
  await invoke("emitGpioIn", [2, 1, 1]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(1);
  await invoke("emitGpioIn", [2, 1, 0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("product does not write the scope until tick", async () => {
  const diagram = new Diagram("prod_wait", "prod_wait", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "p");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "p", "v", 0);
  connect(diagram, "b", "v", 0, "p", "v", 1);
  await compileDiagram(diagram);
  expect(await invoke("hasPin", [0, 0])).toBe(0);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(12);
});

test("sum of three constants", async () => {
  const diagram = new Diagram("sum3", "sum3", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("sum_f32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 1 });
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 2 });
  diagram.addBlock("const_f32", { x: 4, y: 0 }, "c", { v: 3 });
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "sum", "v", 0);
  connect(diagram, "b", "v", 0, "sum", "v", 1);
  connect(diagram, "c", "v", 0, "sum", "v", 2);
  await compileDiagram(diagram);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(6);
});

test("gpio OR via sum", async () => {
  const diagram = new Diagram("gpio_or", "gpio_or", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("sum_f32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("gpio_in_f32", { x: 2, y: 0 }, "g", { pins: [0, 1] });
  connect(diagram, "g", "pin", 0, "sum", "v", 0);
  connect(diagram, "g", "pin", 1, "sum", "v", 1);
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [2, 0, 1]);
  await invoke("emitGpioIn", [2, 1, 0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(1);
  await invoke("emitGpioIn", [2, 0, 0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("nested products multiply four constants", async () => {
  const diagram = new Diagram("tree", "tree", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "root");
  diagram.addBlock("product_f32", { x: 2, y: 0 }, "left");
  diagram.addBlock("product_f32", { x: 3, y: 0 }, "right");
  diagram.addBlock("const_f32", { x: 4, y: 0 }, "c1", { v: 2 });
  diagram.addBlock("const_f32", { x: 5, y: 0 }, "c2", { v: 3 });
  diagram.addBlock("const_f32", { x: 6, y: 0 }, "c3", { v: 4 });
  diagram.addBlock("const_f32", { x: 7, y: 0 }, "c4", { v: 5 });
  connect(diagram, "c1", "v", 0, "left", "v", 0);
  connect(diagram, "c2", "v", 0, "left", "v", 1);
  connect(diagram, "c3", "v", 0, "right", "v", 0);
  connect(diagram, "c4", "v", 0, "right", "v", 1);
  connect(diagram, "left", "p", 0, "root", "v", 0);
  connect(diagram, "right", "p", 0, "root", "v", 1);
  connect(diagram, "root", "p", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("tickThenObserve");
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(120);
});

test("const through cos into a product with another const", async () => {
  const diagram = new Diagram("mix", "mix", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "p");
  diagram.addBlock("cos_f32", { x: 2, y: 0 }, "c");
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "zero", { v: 0 });
  diagram.addBlock("const_f32", { x: 4, y: 0 }, "amp", { v: 5 });
  connect(diagram, "zero", "v", 0, "c", "v", 0);
  connect(diagram, "c", "cos", 0, "p", "v", 0);
  connect(diagram, "amp", "v", 0, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(5);
});

test("const to scope increments pinWriteCount", async () => {
  const diagram = new Diagram("writes", "writes", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 2 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("pinWriteCount")).toBe(1);
  await invoke("clearPins");
  expect(await invoke("hasPin", [0, 0])).toBe(0);
  expect(await invoke("pinWriteCount")).toBe(0);
});

test("wave generators register a tick interval", async () => {
  const diagram = new Diagram("intv", "intv", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("cos_gen_f32", { x: 1, y: 0 }, "g", { precision: 20 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("activeIntervalCount")).toBe(1);
  expect(await invoke("intervalPeriodAt", [0])).toBe(20);
  await invoke("close");
  expect(await invoke("activeIntervalCount")).toBe(0);
});

test("const to scope does not register an interval", async () => {
  const diagram = new Diagram("noint", "noint", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 1 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  expect(await invoke("activeIntervalCount")).toBe(0);
});

test("cos_gen_f32 at a half period is negative one", async () => {
  const diagram = new Diagram("cgen_half", "cgen_half", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("cos_gen_f32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("setNow", [500]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBeCloseTo(-1, 3);
});

test("gpio high through product with const two", async () => {
  const diagram = new Diagram("gpio_scale", "gpio_scale", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  diagram.addBlock("product_f32", { x: 1, y: 0 }, "p");
  diagram.addBlock("gpio_in_f32", { x: 2, y: 0 }, "g");
  diagram.addBlock("const_f32", { x: 3, y: 0 }, "c", { v: 2 });
  connect(diagram, "g", "pin", 0, "p", "v", 0);
  connect(diagram, "c", "v", 0, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [2, 0, 1]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(2);
  await invoke("emitGpioIn", [2, 0, 0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBe(0);
});

test("diagram_demo.cpp cos_gen writes the first scope channel", async () => {
  const diagram = await Diagram.fromCpp(readFileSync(join(coreAssets, "diagram_demo.cpp"), "utf8"), palette);
  await compileDiagram(diagram);
  await invoke("setNow", [0]);
  await invoke("tickThenObserve");
  expect(await invoke("lastPin", [0, 0])).toBeCloseTo(1, 5);
});

test("two independent gpio blocks drive two scopes", async () => {
  const diagram = new Diagram("two_gpio", "two_gpio", palette);
  diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s0");
  diagram.addBlock("scope_f32", { x: 0, y: 1 }, "s1");
  diagram.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g0", { port: 1, pins: [4] });
  diagram.addBlock("gpio_in_f32", { x: 1, y: 1 }, "g1", { port: 2, pins: [5] });
  connect(diagram, "g0", "pin", 0, "s0", "sink", 0);
  connect(diagram, "g1", "pin", 0, "s1", "sink", 0);
  await compileDiagram(diagram);
  await invoke("emitGpioIn", [2, 0, 1]);
  await invoke("emitGpioIn", [3, 0, 0]);
  expect(await invoke("lastPin", [0, 0])).toBe(1);
  expect(await invoke("lastPin", [1, 0])).toBe(0);
});
