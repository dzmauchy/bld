import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type CppSession } from "./fixtures/cpp.ts";
import "../../core/tests/nodeFileFetch.ts";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  PortEndpoint,
  registerAppAssets,
} from "core";
import "../src/hostClangAstDumper.ts";
import { ClangFunctionCatalog } from "../../core/src/model/clangFunctionCatalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const coreAssets = join(here, "../../core/assets");

registerAppAssets({
  "base.json": readFileSync(join(coreAssets, "base.json"), "utf8"),
});

let builder: CppDiagramBuilder;
let palette: Awaited<ReturnType<typeof Library.load>>["palette"];

function connect(diagram: Diagram, fromId: string, _fromPort: string, fromVec: number, toId: string, _toPort: string, toVec: number): void {
  const source = diagram.getBlock(toId)!;
  const target = diagram.getBlock(fromId)!;
  const output = source.definition.getOutput("channels") ? "channels" : "consumer";
  const input = target.definition.getInput("pins") ? "pins" : "downstream";
  diagram.connect(new PortEndpoint(toId, "output", output, toVec), new PortEndpoint(fromId, "input", input, fromVec));

}

async function compileDiagram(cpp: CppSession, diagram: Diagram): Promise<void> {
  const analysis = await builder.analyze(diagram, cpp.astDumper);
  expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
  await cpp.compile(builder.build(diagram));
}

test.beforeAll(async ({ cpp }) => {
  const library = await Library.load("base.json");
  palette = library.palette;
  builder = new CppDiagramBuilder(library.compilationModel.getFiles());
});

test.afterEach(async ({ cpp }) => {
  await cpp.expectWorkersReused();
});

test("ConstF32 writes to a scope channel", async ({ cpp }) => {
  const diagram = new Diagram("const_scope", "const_scope", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 3.5 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(3.5);
  expect(await cpp.invoke("hasPin", [0, 0])).toBe(1);
});

test("ConstF32 fans out across two scope channels", async ({ cpp }) => {
  const diagram = new Diagram("fan", "fan", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 8 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  connect(diagram, "c", "v", 0, "s", "sink", 1);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(8);
  expect(await cpp.invoke("lastPin", [0, 1])).toBe(8);
});

test("independent scope channels stay independent", async ({ cpp }) => {
  const diagram = new Diagram("indep", "indep", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "a", { value: 1.5 });
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "b", { value: 9.5 });
  connect(diagram, "a", "v", 0, "s", "sink", 0);
  connect(diagram, "b", "v", 0, "s", "sink", 1);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1.5);
  expect(await cpp.invoke("lastPin", [0, 1])).toBe(9.5);
});

test("CosF32 of zero is one", async ({ cpp }) => {
  const diagram = new Diagram("cos", "cos", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("CosF32", { x: 1, y: 0 }, "cs");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "z", { value: 0 });
  connect(diagram, "z", "v", 0, "cs", "v", 0);
  connect(diagram, "cs", "cos", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
});

test("SinF32 of zero is zero", async ({ cpp }) => {
  const diagram = new Diagram("sin", "sin", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("SinF32", { x: 1, y: 0 }, "sn");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "z", { value: 0 });
  connect(diagram, "z", "v", 0, "sn", "v", 0);
  connect(diagram, "sn", "sin", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("product of two constants appears on the scope after tick", async ({ cpp }) => {
  const diagram = new Diagram("prod", "prod", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "p");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "a", { value: 3 });
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "b", { value: 4 });
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "p", "v", 0);
  connect(diagram, "b", "v", 0, "p", "v", 1);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(12);
});

test("sum of two constants appears on the scope after tick", async ({ cpp }) => {
  const diagram = new Diagram("sum", "sum", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("SumF32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "a", { value: 3 });
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "b", { value: 4 });
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "sum", "v", 0);
  connect(diagram, "b", "v", 0, "sum", "v", 1);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(7);
});

test("CosGenF32 at t=0 is one", async ({ cpp }) => {
  const diagram = new Diagram("cgen", "cgen", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("CosGenF32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setNow", [0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBeCloseTo(1, 5);
});

test("SinGenF32 at a quarter period is one", async ({ cpp }) => {
  const diagram = new Diagram("sgen", "sgen", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("SinGenF32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setNow", [250]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBeCloseTo(1, 3);
});

test("RandGenF32 uses injected random scaled by amplitude", async ({ cpp }) => {
  const diagram = new Diagram("rand", "rand", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("RandGenF32", { x: 1, y: 0 }, "g", { amplitude: 2 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setRandom", [0.25]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBeCloseTo(0.5, 5);
});

test("PulseGenF32 is high then low across the duty window", async ({ cpp }) => {
  const diagram = new Diagram("pulse", "pulse", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("PulseGenF32", { x: 1, y: 0 }, "g", { dutyCycle: 0.5, frequency: 1 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setNow", [0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  await cpp.invoke("setNow", [500]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("GpioInF32 true is one on the scope", async ({ cpp }) => {
  const diagram = new Diagram("gpio_hi", "gpio_hi", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g", { pins: [0] });
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [1, 0, 1]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
});

test("GpioInF32 false is zero on the scope", async ({ cpp }) => {
  const diagram = new Diagram("gpio_lo", "gpio_lo", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [1, 0, 0]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("GpioInF32 routes multiple pins onto independent scope channels", async ({ cpp }) => {
  const diagram = new Diagram("gpio_multi", "gpio_multi", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g", { port: 7, pins: [1, 3] });
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  connect(diagram, "g", "pin", 1, "s", "sink", 1);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [1, 0, 1]);
  await cpp.invoke("emitGpioIn", [1, 1, 0]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  expect(await cpp.invoke("lastPin", [0, 1])).toBe(0);
});

test("GPIO span groups preserve disconnected pins and fan out one pin", async ({ cpp }) => {
  const diagram = new Diagram("sparse_gpio", "Sparse GPIO", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g", { port: 2, pins: [3, 4, 5] });
  connect(diagram, "g", "pin", 2, "s", "sink", 0);
  connect(diagram, "g", "pin", 2, "s", "sink", 1);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [1, 0, 1]);
  expect(await cpp.invoke("pinWriteCount")).toBe(0);
  await cpp.invoke("emitGpioIn", [1, 2, 1]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  expect(await cpp.invoke("lastPin", [0, 1])).toBe(1);
  await cpp.invoke("emitGpioIn", [1, 2, 0]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
  expect(await cpp.invoke("lastPin", [0, 1])).toBe(0);
  expect(await cpp.invoke("pinWriteCount")).toBe(4);
});

test("browser factory analysis discovers defaults for all released blocks", async ({ cpp }) => {
  const diagram = new Diagram("factories", "Factories", palette);
  for (const definition of palette.getBlocks()) diagram.addBlock(definition, { x: 0, y: 0 });
  const analysis = await builder.analyze(diagram, cpp.astDumper);
  expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
  for (const precision of ["F32", "F64"]) {
    expect(palette.getBlock(`GpioIn${precision}`)?.getDefaultConfig()).toEqual({ port: 0, pins: [0] });
    expect(palette.getBlock(`Scope${precision}`)?.getDefaultConfig()).toEqual({ period: 60, precision: 10 });
    expect(palette.getBlock(`PulseGen${precision}`)?.getDefaultConfig()).toEqual({ dutyCycle: 0.5, amplitude: 1, frequency: 1, phase: 0 });
  }
  const gpio = diagram.getBlocks().find((block) => block.definition.id === "GpioInF32")!;
  gpio.setConf("pins", []);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("activeGpioListenerCount")).toBe(1); // Only GpioInF64 keeps its default pin.
});

test("GpioInF32 close stops listening", async ({ cpp }) => {
  const diagram = new Diagram("gpio_close", "gpio_close", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "pin", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("activeGpioListenerCount")).toBe(1);
  await cpp.invoke("close");
  expect(await cpp.invoke("activeGpioListenerCount")).toBe(0);
  await cpp.invoke("clearPins");
  await cpp.invoke("emitGpioIn", [1, 0, 1]);
  expect(await cpp.invoke("hasPin", [0, 0])).toBe(0);
});

test("gpio pin through cos into scope", async ({ cpp }) => {
  const diagram = new Diagram("gpio_cos", "gpio_cos", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("CosF32", { x: 1, y: 0 }, "c");
  diagram.addBlock("GpioInF32", { x: 2, y: 0 }, "g", { pins: [0] });
  connect(diagram, "g", "pin", 0, "c", "v", 0);
  connect(diagram, "c", "cos", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [2, 0, 0]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
});

test("gpio AND via product", async ({ cpp }) => {
  const diagram = new Diagram("gpio_and", "gpio_and", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "p");
  diagram.addBlock("GpioInF32", { x: 2, y: 0 }, "g", { pins: [0, 1] });
  connect(diagram, "g", "pin", 0, "p", "v", 0);
  connect(diagram, "g", "pin", 1, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [2, 0, 1]);
  await cpp.invoke("emitGpioIn", [2, 1, 1]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  await cpp.invoke("emitGpioIn", [2, 1, 0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("product does not write the scope until tick", async ({ cpp }) => {
  const diagram = new Diagram("prod_wait", "prod_wait", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "p");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "a", { value: 3 });
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "b", { value: 4 });
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "p", "v", 0);
  connect(diagram, "b", "v", 0, "p", "v", 1);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("hasPin", [0, 0])).toBe(0);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(12);
});

test("sum of three constants", async ({ cpp }) => {
  const diagram = new Diagram("sum3", "sum3", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("SumF32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("ConstF32", { x: 2, y: 0 }, "a", { value: 1 });
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "b", { value: 2 });
  diagram.addBlock("ConstF32", { x: 4, y: 0 }, "c", { value: 3 });
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  connect(diagram, "a", "v", 0, "sum", "v", 0);
  connect(diagram, "b", "v", 0, "sum", "v", 1);
  connect(diagram, "c", "v", 0, "sum", "v", 2);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(6);
});

test("gpio OR via sum", async ({ cpp }) => {
  const diagram = new Diagram("gpio_or", "gpio_or", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("SumF32", { x: 1, y: 0 }, "sum");
  diagram.addBlock("GpioInF32", { x: 2, y: 0 }, "g", { pins: [0, 1] });
  connect(diagram, "g", "pin", 0, "sum", "v", 0);
  connect(diagram, "g", "pin", 1, "sum", "v", 1);
  connect(diagram, "sum", "s", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [2, 0, 1]);
  await cpp.invoke("emitGpioIn", [2, 1, 0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  await cpp.invoke("emitGpioIn", [2, 0, 0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("nested products multiply four constants", async ({ cpp }) => {
  const diagram = new Diagram("tree", "tree", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "root");
  diagram.addBlock("ProductF32", { x: 2, y: 0 }, "left");
  diagram.addBlock("ProductF32", { x: 3, y: 0 }, "right");
  diagram.addBlock("ConstF32", { x: 4, y: 0 }, "c1", { value: 2 });
  diagram.addBlock("ConstF32", { x: 5, y: 0 }, "c2", { value: 3 });
  diagram.addBlock("ConstF32", { x: 6, y: 0 }, "c3", { value: 4 });
  diagram.addBlock("ConstF32", { x: 7, y: 0 }, "c4", { value: 5 });
  connect(diagram, "c1", "v", 0, "left", "v", 0);
  connect(diagram, "c2", "v", 0, "left", "v", 1);
  connect(diagram, "c3", "v", 0, "right", "v", 0);
  connect(diagram, "c4", "v", 0, "right", "v", 1);
  connect(diagram, "left", "p", 0, "root", "v", 0);
  connect(diagram, "right", "p", 0, "root", "v", 1);
  connect(diagram, "root", "p", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("tickThenObserve");
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(120);
});

test("const through cos into a product with another const", async ({ cpp }) => {
  const diagram = new Diagram("mix", "mix", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "p");
  diagram.addBlock("CosF32", { x: 2, y: 0 }, "c");
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "zero", { value: 0 });
  diagram.addBlock("ConstF32", { x: 4, y: 0 }, "amp", { value: 5 });
  connect(diagram, "zero", "v", 0, "c", "v", 0);
  connect(diagram, "c", "cos", 0, "p", "v", 0);
  connect(diagram, "amp", "v", 0, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(5);
});

test("const to scope increments pinWriteCount", async ({ cpp }) => {
  const diagram = new Diagram("writes", "writes", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 2 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("pinWriteCount")).toBe(1);
  await cpp.invoke("clearPins");
  expect(await cpp.invoke("hasPin", [0, 0])).toBe(0);
  expect(await cpp.invoke("pinWriteCount")).toBe(0);
});

test("wave generators register a tick interval", async ({ cpp }) => {
  const diagram = new Diagram("intv", "intv", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("CosGenF32", { x: 1, y: 0 }, "g", { precision: 20 });
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("activeIntervalCount")).toBe(1);
  expect(await cpp.invoke("intervalPeriodAt", [0])).toBe(20);
  await cpp.invoke("close");
  expect(await cpp.invoke("activeIntervalCount")).toBe(0);
});

test("const to scope does not register an interval", async ({ cpp }) => {
  const diagram = new Diagram("noint", "noint", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 1 });
  connect(diagram, "c", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("activeIntervalCount")).toBe(0);
});

test("CosGenF32 at a half period is negative one", async ({ cpp }) => {
  const diagram = new Diagram("cgen_half", "cgen_half", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("CosGenF32", { x: 1, y: 0 }, "g");
  connect(diagram, "g", "v", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setNow", [500]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBeCloseTo(-1, 3);
});

test("gpio high through product with const two", async ({ cpp }) => {
  const diagram = new Diagram("gpio_scale", "gpio_scale", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
  diagram.addBlock("ProductF32", { x: 1, y: 0 }, "p");
  diagram.addBlock("GpioInF32", { x: 2, y: 0 }, "g");
  diagram.addBlock("ConstF32", { x: 3, y: 0 }, "c", { value: 2 });
  connect(diagram, "g", "pin", 0, "p", "v", 0);
  connect(diagram, "c", "v", 0, "p", "v", 1);
  connect(diagram, "p", "p", 0, "s", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [2, 0, 1]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(2);
  await cpp.invoke("emitGpioIn", [2, 0, 0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(0);
});

test("diagram_demo.cpp cos_gen writes the first scope channel", async ({ cpp }) => {
  const diagram = await Diagram.fromCpp(readFileSync(join(coreAssets, "diagram_demo.cpp"), "utf8"), palette);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("setNow", [0]);
  await cpp.invoke("tickThenObserve");
  expect(await cpp.invoke("lastPin", [0, 0])).toBeCloseTo(1, 5);
});

test("two independent gpio blocks drive two scopes", async ({ cpp }) => {
  const diagram = new Diagram("two_gpio", "two_gpio", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s0");
  diagram.addBlock("ScopeF32", { x: 0, y: 1 }, "s1");
  diagram.addBlock("GpioInF32", { x: 1, y: 0 }, "g0", { port: 1, pins: [4] });
  diagram.addBlock("GpioInF32", { x: 1, y: 1 }, "g1", { port: 2, pins: [5] });
  connect(diagram, "g0", "pin", 0, "s0", "sink", 0);
  connect(diagram, "g1", "pin", 0, "s1", "sink", 0);
  await compileDiagram(cpp, diagram);
  await cpp.invoke("emitGpioIn", [2, 0, 1]);
  await cpp.invoke("emitGpioIn", [3, 0, 0]);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1);
  expect(await cpp.invoke("lastPin", [1, 0])).toBe(0);
});

test("F64 retains double precision through the browser runtime", async ({ cpp }) => {
  const diagram = new Diagram("double", "double", palette);
  diagram.addBlock("ScopeF64", { x: 0, y: 0 }, "scope");
  diagram.addBlock("ConstF64", { x: 1, y: 0 }, "constant", { value: 1.234567890123 });
  diagram.connect(new PortEndpoint("scope", "output", "channels"), new PortEndpoint("constant", "input", "downstream"));
  await compileDiagram(cpp, diagram);
  expect(await cpp.invoke("lastPin", [0, 0])).toBe(1.234567890123);
  expect(await cpp.invoke("hasPin", [0, 0])).toBe(1);
  expect(await cpp.invoke("pinWriteCount")).toBe(1);
});

test("browser AST reports incompatible ports with endpoint IDs", async ({ cpp }) => {
  const diagram = new Diagram("mismatch", "mismatch", palette);
  diagram.addBlock("ScopeF64", { x: 0, y: 0 }, "scope");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "constant");
  diagram.connect(new PortEndpoint("scope", "output", "channels"), new PortEndpoint("constant", "input", "downstream"), "incompatible");
  const result = await builder.analyze(diagram, cpp.astDumper);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.find((d) => d.severity === "error")).toMatchObject({ blockId: "constant", inputId: "downstream", outputId: "channels", connectionId: "incompatible" });
});

test("diagram AST analysis reads main-file declarations with lazy precompiled headers", async ({ cpp }) => {
  const diagram = new Diagram("compact_ast", "Compact AST", palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "scope");
  diagram.addBlock("ConstF32", { x: 1, y: 0 }, "constant");
  connect(diagram, "constant", "v", 0, "scope", "sink", 0);
  const analysis = await builder.analyze(diagram, cpp.astDumper);
  expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
  const dump = await cpp.astDumper.dumpAsync(builder.build(diagram), "diagram.cpp");
  expect(dump.ok, dump.diagnostics).toBe(true);
  const ast = dump.ast as { inner?: { kind?: string; name?: string }[] };
  expect(JSON.stringify(dump.ast)).toContain('"name":"mount"');
  const factories = ClangFunctionCatalog.fromAst(ast);
  expect(factories.parametersFor("push::f_32::sinks::ScopeF32")).toBeUndefined();
  expect(factories.parametersFor("push::f_32::sinks::bld_factory_0")?.map((param) => param.defaultValue)).toEqual([60, 10]);
  const bytes = new TextEncoder().encode(JSON.stringify(dump.ast)).byteLength;
  expect(bytes).toBeLessThan(2_000_000);
  test.info().annotations.push({ type: "AST bytes", description: String(bytes) });
});
