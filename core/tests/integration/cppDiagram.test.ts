import { beforeAll, describe, expect, test } from "@rstest/core";
import { CppDiagramBuilder } from "../../src/model/cppBuilder.ts";
import { Diagram } from "../../src/model/diagram.ts";
import { Library } from "../../src/model/library.ts";
import { Palette } from "../../src/model/palette.ts";
import { PortEndpoint } from "../../src/model/endpoint.ts";
import { defaultCppBlockCatalog } from "../../src/model/cppBlockCatalog.ts";

let palette: Palette;
let builder: CppDiagramBuilder;

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
  builder = new CppDiagramBuilder(lib.compilationModel.getFiles());
});

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

function emit(build: (diagram: Diagram) => void): string {
  const diagram = new Diagram("integration", "integration", palette);
  build(diagram);
  return builder.emitDiagram(diagram);
}

describe("diagram C++ generation topologies", () => {
  test("every catalog block can be constructed", () => {
    const cpp = emit((d) => {
      for (const ref of defaultCppBlockCatalog.refs()) d.addBlock(ref, { x: 0, y: 0 }, ref);
    });
    for (const ref of defaultCppBlockCatalog.refs()) {
      expect(cpp).toContain(defaultCppBlockCatalog.require(ref).cppClass);
    }
  });

  test("diamond: const splits to cos and sin then product", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("cos_f32", { x: 2, y: 0 }, "c");
      d.addBlock("sin_f32", { x: 3, y: 0 }, "n");
      d.addBlock("const_f32", { x: 4, y: 0 }, "theta", { v: 0.5 });
      connect(d, "theta", "downstream", 0, "c", "out", 0);
      connect(d, "theta", "downstream", 0, "n", "out", 0);
      connect(d, "c", "downstream", 0, "p", "out", 0);
      connect(d, "n", "downstream", 0, "p", "out", 1);
      connect(d, "p", "downstream", 0, "s", "out", 0);
    });
    expect(cpp).toContain("theta_dn_items[2] = {c_in, n_in}");
    expect(cpp).toContain("auto theta_dn = arrayFrom(theta_dn_items, 2u)");
    expect(cpp).toContain("p->apply(static_cast<Vectorized<Pss<float>>&&>(p_dn), static_cast<u8>(2))");
  });

  test("gpio AND product into scope", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("gpio_in_f32", { x: 2, y: 0 }, "gpio", { pins: [0, 1] });
      connect(d, "gpio", "sinks", 0, "p", "out", 0);
      connect(d, "gpio", "sinks", 1, "p", "out", 1);
      connect(d, "p", "downstream", 0, "s", "out", 0);
    });
    expect(cpp).toContain("gpio_p0_items[1] = {p_in[0]}");
    expect(cpp).toContain("gpio_p1_items[1] = {p_in[1]}");
    expect(cpp).toContain("register_gpio_block");
  });

  test("gpio fan-out to cos and sin", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("cos_f32", { x: 1, y: 0 }, "c");
      d.addBlock("sin_f32", { x: 2, y: 0 }, "n");
      d.addBlock("gpio_in_f32", { x: 3, y: 0 }, "gpio", { pins: [0] });
      connect(d, "gpio", "sinks", 0, "c", "out", 0);
      connect(d, "gpio", "sinks", 0, "n", "out", 0);
      connect(d, "c", "downstream", 0, "s", "out", 0);
      connect(d, "n", "downstream", 0, "s", "out", 1);
    });
    expect(cpp).toContain("gpio_p0_items[2] = {c_in, n_in}");
    expect(cpp).toContain("auto gpio_p0 = arrayFrom(gpio_p0_items, 2u)");
  });

  test("demo asset emits cos_gen into scope", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const diagram = await Diagram.fromCpp(readFileSync(join(here, "../../assets/diagram_demo.cpp"), "utf8"), palette);
    const cpp = builder.emitDiagram(diagram);
    expect(cpp).toContain("CosGenF32");
    expect(cpp).toContain("ScopeF32");
    expect(cpp).toContain("GpioInF32");
  });

  test("JSON cpp class names match generated new-expressions", async () => {
    const lib = await Library.load("base.json");
    for (const [id, raw] of Object.entries(lib.blocks)) {
      expect(raw.cpp).toBe(defaultCppBlockCatalog.require(id).cppClass);
    }
  });

  test("sum of gpio pins into a scope", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sum_f32", { x: 1, y: 0 }, "sum");
      d.addBlock("gpio_in_f32", { x: 2, y: 0 }, "gpio", { pins: [0, 1] });
      connect(d, "gpio", "sinks", 0, "sum", "out", 0);
      connect(d, "gpio", "sinks", 1, "sum", "out", 1);
      connect(d, "sum", "downstream", 0, "s", "out", 0);
    });
    expect(cpp).toContain("SumF32");
    expect(cpp).toContain("gpio_p0_items[1] = {sum_in[0]}");
    expect(cpp).toContain("gpio_p1_items[1] = {sum_in[1]}");
  });

  test("wave generators wire into independent scope channels", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("cos_gen_f32", { x: 1, y: 0 }, "cg");
      d.addBlock("pulse_gen_f32", { x: 2, y: 0 }, "pg");
      connect(d, "cg", "downstream", 0, "s", "out", 0);
      connect(d, "pg", "downstream", 0, "s", "out", 1);
    });
    expect(cpp).toContain("cg_dn_items[1] = {s_in[0]}");
    expect(cpp).toContain("pg_dn_items[1] = {s_in[1]}");
  });
});
