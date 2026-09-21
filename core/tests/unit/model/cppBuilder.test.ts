import { beforeAll, describe, expect, test } from "vitest";
import { nativeLibraryFiles } from "base";
import { BlockDefinition } from "../../../src/model/blockDefinition.ts";
import { CppDiagramBuilder } from "../../../src/model/cppBuilder.ts";
import { Diagram } from "../../../src/model/diagram.ts";
import { Library } from "../../../src/model/library.ts";
import { Palette } from "../../../src/model/palette.ts";
import { PortEndpoint } from "../../../src/model/endpoint.ts";

let palette: Palette;
const builder = new CppDiagramBuilder(nativeLibraryFiles());

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
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
    expect(files.get("bld.hpp")).toContain("class Block");
    expect(files.get("base.hpp")).toContain("class ScopeF32");
    expect(files.get("wasm_host.inc")).toContain("void start()");
    expect(files.get("wasm_host.cpp")).toBeUndefined();
    expect([...files.keys()].filter((name) => name.endsWith(".cpp"))).toEqual(["diagram.cpp"]);
    expect(files.get("diagram.cpp")).toContain("#include \"wasm_host.inc\"");
    expect(files.get("diagram.cpp")).toContain("build_diagram");
  });

  test("emits const to scope wiring", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
      connect(d, "c", "v", 0, "s", "sink", 0);
    });
    expect(cpp).toContain("new push::f32::sinks::ScopeF32(0u, 60u, 10u)");
    expect(cpp).toContain("new push::f32::sources::ConstF32(1u, 3.5f)");
    expect(cpp).toContain("s_in = s->apply(static_cast<u8>(1))");
    expect(cpp).toContain("c_dn.push_back(s_in[0])");
    expect(cpp).toContain("c->apply(static_cast<VectorizedInput<Pss<f32>>&&>(c_dn))");
  });

  test("fans a constant out to two scope channels", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 8 });
      connect(d, "c", "v", 0, "s", "sink", 0);
      connect(d, "c", "v", 0, "s", "sink", 1);
    });
    expect(cpp).toContain("s->apply(static_cast<u8>(2))");
    expect(cpp).toContain("c_dn.push_back(s_in[0])");
    expect(cpp).toContain("c_dn.push_back(s_in[1])");
  });

  test("emits unary cos then sin chain", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sin_f32", { x: 1, y: 0 }, "sn");
      d.addBlock("cos_f32", { x: 2, y: 0 }, "cs");
      d.addBlock("const_f32", { x: 3, y: 0 }, "zero", { v: 0 });
      connect(d, "zero", "v", 0, "cs", "v", 0);
      connect(d, "cs", "cos", 0, "sn", "v", 0);
      connect(d, "sn", "sin", 0, "s", "sink", 0);
    });
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("sn->apply"));
    expect(cpp.indexOf("sn->apply")).toBeLessThan(cpp.indexOf("cs->apply"));
    expect(cpp.indexOf("cs->apply")).toBeLessThan(cpp.indexOf("zero->apply"));
    expect(cpp).toContain("sn_dn.push_back(s_in[0])");
    expect(cpp).toContain("cs_dn.push_back(sn_in)");
    expect(cpp).toContain("zero_dn.push_back(cs_in)");
  });

  test("emits product of two constants", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("product_f32", { x: 1, y: 0 }, "p");
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 3 });
      d.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 4 });
      connect(d, "p", "p", 0, "s", "sink", 0);
      connect(d, "a", "v", 0, "p", "v", 0);
      connect(d, "b", "v", 0, "p", "v", 1);
    });
    expect(cpp).toContain("p->apply(static_cast<VectorizedInput<Pss<f32>>&&>(p_dn), static_cast<u8>(2))");
    expect(cpp).toContain("a_dn.push_back(p_in[0])");
    expect(cpp).toContain("b_dn.push_back(p_in[1])");
  });

  test("emits sum with configured precision", () => {
    const cpp = emit((d) => {
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      d.addBlock("sum_f32", { x: 1, y: 0 }, "sum", { precision: 25 });
      d.addBlock("const_f32", { x: 2, y: 0 }, "a", { v: 1 });
      d.addBlock("const_f32", { x: 3, y: 0 }, "b", { v: 2 });
      connect(d, "sum", "s", 0, "s", "sink", 0);
      connect(d, "a", "v", 0, "sum", "v", 0);
      connect(d, "b", "v", 0, "sum", "v", 1);
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
      connect(d, "cg", "v", 0, "s", "sink", 0);
      connect(d, "sg", "v", 0, "s", "sink", 1);
      connect(d, "rg", "v", 0, "s", "sink", 2);
      connect(d, "pg", "v", 0, "s", "sink", 3);
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
      connect(d, "g", "pin", 0, "s", "sink", 0);
      connect(d, "g", "pin", 1, "s", "sink", 1);
    });
    expect(cpp).toContain("g_pins.push_back(1)");
    expect(cpp).toContain("g_pins.push_back(3)");
    expect(cpp).toContain("new push::f32::sources::GpioInF32(1u, 7, static_cast<Array<u8>&&>(g_pins))");
    expect(cpp).toContain("g_p0.push_back(s_in[0])");
    expect(cpp).toContain("g_p1.push_back(s_in[1])");
    expect(cpp).toContain("g->connectPin(static_cast<u8>(0)");
    expect(cpp).toContain("g->apply();");
    expect(cpp).toContain("register_gpio_block(1u, 7, g_hw)");
  });

  test("applies sinks before sources", () => {
    const cpp = emit((d) => {
      d.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 1 });
      d.addBlock("scope_f32", { x: 0, y: 0 }, "s");
      connect(d, "c", "v", 0, "s", "sink", 0);
    });
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("c->apply"));
  });

  test("rejects diagrams with cycles", () => {
    expect(() =>
      emit((d) => {
        d.addBlock("cos_f32", { x: 0, y: 0 }, "a");
        d.addBlock("sin_f32", { x: 1, y: 0 }, "b");
        connect(d, "a", "cos", 0, "b", "v", 0);
        connect(d, "b", "sin", 0, "a", "v", 0);
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
