import { beforeAll, describe, expect, test } from "@rstest/core";
import { BlockDefinition } from "../../../src/model/blockDefinition.ts";
import { CppDiagramBuilder } from "../../../src/model/cppBuilder.ts";
import { Diagram } from "../../../src/model/diagram.ts";
import { Library } from "../../../src/model/library.ts";
import { Palette } from "../../../src/model/palette.ts";
import { PortEndpoint } from "../../../src/model/endpoint.ts";

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
  const diagram = new Diagram("cpp", "cpp", palette);
  build(diagram);
  return builder.emitDiagram(diagram);
}

describe("CppDiagramBuilder", () => {
  test("includes native library files", () => {
    const diagram = new Diagram("empty", "empty", palette);
    diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
    const files = builder.build(diagram);
    expect(files.get("core/block.hpp")).toContain("class Block");
    expect(files.get("base/f32_blocks.hpp")).toContain("class ScopeF32");
    expect(files.get("browser/host.hpp")).toContain("void start()");
    expect(files.get("wasm_host.cpp")).toBeUndefined();
    expect([...files.keys()].filter((name) => name.endsWith(".cpp"))).toEqual(["diagram.cpp"]);
    expect(files.get("diagram.cpp")).toContain("#include <browser/host.hpp>");
    expect(files.get("diagram.cpp")).toContain("void mount()");
    expect(files.get("diagram.cpp")).toContain("bld_keep_lastPin = &lastPin");
    expect(files.get("diagram.cpp")).toContain("bld_keep_start = &start");
    expect(files.get("diagram.cpp")).not.toContain("start(");
  });

  test("emits const to scope wiring", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
      connect(d, "c", "downstream", 0, "s", "out", 0);
    });
    expect(cpp).toContain("new push::f32::sinks::ScopeF32(0u, 60u, 10u)");
    expect(cpp).toContain("new push::f32::sources::ConstF32(1u, 3.5f)");
    expect(cpp).toContain("s_in = s->apply(static_cast<u8>(1))");
    expect(cpp).toContain("c_dn_items[1] = {s_in[0]}");
    expect(cpp).toContain("c->apply(static_cast<Vectorized<Pss<float>>&&>(c_dn))");
  });

  test("fans a constant out to two scope channels", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 8 });
      connect(d, "c", "downstream", 0, "s", "out", 0);
      connect(d, "c", "downstream", 0, "s", "out", 1);
    });
    expect(cpp).toContain("s->apply(static_cast<u8>(2))");
    expect(cpp).toContain("c_dn_items[2] = {s_in[0], s_in[1]}");
    expect(cpp).toContain("auto c_dn = arrayFrom(c_dn_items, 2u)");
  });

  test("emits unary cos then sin chain", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sin_f32", { x: 1, y: 0 }, "sn");
      d.addBlock("cos_f32", { x: 2, y: 0 }, "cs");
      d.addBlock("const_f32", { x: 3, y: 0 }, "zero", { v: 0 });
      connect(d, "zero", "downstream", 0, "cs", "out", 0);
      connect(d, "cs", "downstream", 0, "sn", "out", 0);
      connect(d, "sn", "downstream", 0, "s", "out", 0);
    });
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("sn->apply"));
    expect(cpp.indexOf("sn->apply")).toBeLessThan(cpp.indexOf("cs->apply"));
    expect(cpp.indexOf("cs->apply")).toBeLessThan(cpp.indexOf("zero->apply"));
    expect(cpp).toContain("sn_dn_items[1] = {s_in[0]}");
    expect(cpp).toContain("cs_dn_items[1] = {sn_in}");
    expect(cpp).toContain("zero_dn_items[1] = {cs_in}");
  });

  test("emits product of two constants", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
      d.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
      connect(d, "p", "downstream", 0, "s", "out", 0);
      connect(d, "a", "downstream", 0, "p", "out", 0);
      connect(d, "b", "downstream", 0, "p", "out", 1);
    });
    expect(cpp).toContain("p->apply(static_cast<Vectorized<Pss<float>>&&>(p_dn), static_cast<u8>(2))");
    expect(cpp).toContain("a_dn_items[1] = {p_in[0]}");
    expect(cpp).toContain("b_dn_items[1] = {p_in[1]}");
  });

  test("emits sum with configured precision", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sum_f32", { x: 1, y: 0 }, "sum", { precision: 25 });
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 1 });
      d.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 2 });
      connect(d, "sum", "downstream", 0, "s", "out", 0);
      connect(d, "a", "downstream", 0, "sum", "out", 0);
      connect(d, "b", "downstream", 0, "sum", "out", 1);
    });
    expect(cpp).toContain("new push::f32::transformers::SumF32(1u, 25u)");
  });

  test("emits wave generators with constructor arguments", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("cos_gen_f32", { x: 1, y: 0 }, "cg", { precision: 20, frequency: 2, amplitude: 3, phase: 0.5 });
      d.addBlock("sin_gen_f32", { x: 1, y: 40 }, "sg");
      d.addBlock("rand_gen_f32", { x: 1, y: 80 }, "rg", { amplitude: 2 });
      d.addBlock("pulse_gen_f32", { x: 1, y: 120 }, "pg", { duty_cycle: 0.25, frequency: 4 });
      connect(d, "cg", "downstream", 0, "s", "out", 0);
      connect(d, "sg", "downstream", 0, "s", "out", 1);
      connect(d, "rg", "downstream", 0, "s", "out", 2);
      connect(d, "pg", "downstream", 0, "s", "out", 3);
    });
    expect(cpp).toContain("new push::f32::sources::CosGenF32(1u, 20u, 2.f, 3.f, 0.5f)");
    expect(cpp).toContain("new push::f32::sources::SinGenF32(");
    expect(cpp).toContain("new push::f32::sources::RandGenF32(");
    expect(cpp).toContain("new push::f32::sources::PulseGenF32(");
    expect(cpp).toContain("0.25f");
  });

  test("emits gpio pin groups and register_gpio_block", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("gpio_in_f32", { x: 1, y: 0 }, "g", { port: 7, pins: [1, 3] });
      connect(d, "g", "sinks", 0, "s", "out", 0);
      connect(d, "g", "sinks", 1, "s", "out", 1);
    });
    expect(cpp).toContain("g_pins_items[2] = {1, 3}");
    expect(cpp).toContain("auto g_pins = arrayFrom(g_pins_items, 2u)");
    expect(cpp).toContain("new push::f32::sources::GpioInF32(1u, 7, static_cast<Array<u8>&&>(g_pins))");
    expect(cpp).toContain("g_p0_items[1] = {s_in[0]}");
    expect(cpp).toContain("g_p1_items[1] = {s_in[1]}");
    expect(cpp).toContain("g->connectPin(static_cast<u8>(0)");
    expect(cpp).toContain("g->apply();");
    expect(cpp).toContain("register_gpio_block(1u, 7, g_hw)");
  });

  test("skips empty gpio pin groups while preserving hardware registration", () => {
    const cpp = emit((d) => {
      d.addBlock("gpio_in_f32", { x: 0, y: 0 }, "g", { port: 7, pins: [1, 3] });
    });
    expect(cpp).not.toContain("g_p0");
    expect(cpp).not.toContain("g_p1");
    expect(cpp).not.toContain("g->connectPin");
    expect(cpp).toContain("g->apply();");
    expect(cpp).toContain("g_hw_items[2] = {1, 3}");
    expect(cpp).toContain("register_gpio_block(0u, 7, g_hw)");
  });

  test("applies sinks before sources", () => {
    const cpp = emit((d) => {
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 1 });
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      connect(d, "c", "downstream", 0, "s", "out", 0);
    });
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("c->apply"));
  });

  test("rejects diagrams with cycles", () => {
    expect(() =>
      emit((d) => {
        d.addBlock("cos_f32", { x: 0, y: 0 }, "a");
        d.addBlock("sin_f32", { x: 1, y: 0 }, "b");
        connect(d, "a", "downstream", 0, "b", "out", 0);
        connect(d, "b", "downstream", 0, "a", "out", 0);
      }),
    ).toThrow(/cycle/);
  });

  test("rejects unknown block refs", () => {
    const diagram = new Diagram("bad", "bad", palette);
    const ghost = new BlockDefinition(
      "ghost_f32",
      "Ghost",
      "",
      "",
      ["push", "f32", "sources"],
      "sources",
      new Map(),
      new Map(),
      new Map(),
    );
    diagram.addBlock(ghost, { x: 0, y: 0 }, "g");
    expect(() => builder.emitDiagram(diagram)).toThrow(/Unknown C\+\+ block/);
  });
});
