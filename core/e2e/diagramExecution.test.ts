import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "@rstest/core";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  type DiagramJson,
  type RawBlockJson,
  type RawConnectionJson,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
let builder: CppDiagramBuilder;

export class DiagramJsonBuilder {
  private readonly blocks: Record<string, RawBlockJson> = {};
  private readonly connections: Record<string, RawConnectionJson> = {};
  private connectionCounter = 0;

  constructor(
    public readonly id: string = "e2e_diag",
    public readonly title: string = "E2E Test Diagram",
  ) {}

  addBlock(id: string, ref: string, conf?: Record<string, unknown>, x = 0, y = 0): this {
    this.blocks[id] = { ref, x, y, ...(conf ? { conf } : {}) };
    return this;
  }

  addScope(id: string, conf?: { period?: number; precision?: number }, x = 0, y = 0): this {
    return this.addBlock(id, "scope_f32", conf, x, y);
  }

  addConstant(id: string, value: number, x = 100, y = 0): this {
    return this.addBlock(id, "const_f32", { v: value }, x, y);
  }

  addCosGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "cos_gen_f32", conf, x, y);
  }

  addSinGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "sin_gen_f32", conf, x, y);
  }

  addRandGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "rand_gen_f32", conf, x, y);
  }

  addPulseGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "pulse_gen_f32", conf, x, y);
  }

  addCos(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "cos_f32", {}, x, y);
  }

  addSin(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "sin_f32", {}, x, y);
  }

  addProduct(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "product_f32", {}, x, y);
  }

  addSum(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "sum_f32", {}, x, y);
  }

  addGpio(id: string, pins: number[] = [0], x = 100, y = 0): this {
    return this.addBlock(id, "gpio_in_f32", { pins }, x, y);
  }

  connect(
    fromBlock: string,
    fromPort: string,
    fromVectorIndex: number,
    toBlock: string,
    toPort: string,
    toVectorIndex: number,
    connId?: string,
  ): this {
    const fromType = this.resolvePortType(fromBlock, fromPort);
    const toType = this.resolvePortType(toBlock, toPort);
    const id = connId ?? `${fromBlock}__${toBlock}_${this.connectionCounter++}`;
    this.connections[id] = {
      from: {
        block: fromBlock,
        port: { type: fromType, id: fromPort, vector_index: fromVectorIndex },
      },
      to: {
        block: toBlock,
        port: { type: toType, id: toPort, vector_index: toVectorIndex },
      },
    };
    return this;
  }

  private resolvePortType(blockId: string, portId: string): "input" | "output" {
    if (!this.blocks[blockId]) throw new Error(`Block "${blockId}" not found in builder`);
    return portId === "out" ? "output" : "input";
  }

  build(): DiagramJson {
    return {
      id: this.id,
      title: this.title,
      blocks: { ...this.blocks },
      connections: { ...this.connections },
    };
  }
}

describe("E2E diagram C++ generation", () => {
  let library: Library;

  beforeAll(async () => {
    library = await Library.load("base.json");
    builder = new CppDiagramBuilder(library.compilationModel.getFiles());
  });

  function cppOf(json: DiagramJson): string {
    return builder.emitDiagram(Diagram.fromJSON(json, library.palette));
  }

  test("const_f32 to scope_f32", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder().addScope("s").addConstant("c", 42.5).connect("c", "downstream", 0, "s", "out", 0).build(),
    );
    expect(cpp).toContain("ConstF32");
    expect(cpp).toContain("42.5f");
    expect(cpp).toContain("c_dn_items[1] = {s_in[0]}");
    expect(cpp).toContain("c->apply(static_cast<Vectorized<Pss<float>>&&>(c_dn))");
  });

  test("cos_gen and sin_gen to a multi-channel scope", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addCosGen("cg")
        .addSinGen("sg")
        .connect("cg", "downstream", 0, "s", "out", 0)
        .connect("sg", "downstream", 0, "s", "out", 1)
        .build(),
    );
    expect(cpp).toContain("CosGenF32");
    expect(cpp).toContain("SinGenF32");
    expect(cpp).toContain("s->apply(static_cast<u8>(2))");
  });

  test("rand and pulse generators", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addRandGen("r", { amplitude: 2 })
        .addPulseGen("p", { duty_cycle: 0.25, frequency: 4 })
        .connect("r", "downstream", 0, "s", "out", 0)
        .connect("p", "downstream", 0, "s", "out", 1)
        .build(),
    );
    expect(cpp).toContain("RandGenF32");
    expect(cpp).toContain("PulseGenF32");
    expect(cpp).toContain("0.25f");
  });

  test("unary chain const -> cos -> sin -> scope", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addSin("sn")
        .addConstant("zero", 0)
        .connect("zero", "downstream", 0, "c", "out", 0)
        .connect("c", "downstream", 0, "sn", "out", 0)
        .connect("sn", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("sn->apply"));
    expect(cpp).toContain("zero_dn_items[1] = {c_in}");
  });

  test("product of two constants", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 3.5)
        .addConstant("c2", 4)
        .connect("c1", "downstream", 0, "p", "out", 0)
        .connect("c2", "downstream", 0, "p", "out", 1)
        .connect("p", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp).toContain("ProductF32");
    expect(cpp).toContain("p_dn_items[1] = {s_in[0]}");
    expect(cpp).toContain("p->apply(static_cast<Vectorized<Pss<float>>&&>(p_dn), static_cast<u8>(2))");
  });

  test("sum of three constants", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addSum("sum")
        .addConstant("c1", 1)
        .addConstant("c2", 2)
        .addConstant("c3", 3)
        .connect("c1", "downstream", 0, "sum", "out", 0)
        .connect("c2", "downstream", 0, "sum", "out", 1)
        .connect("c3", "downstream", 0, "sum", "out", 2)
        .connect("sum", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp).toContain("SumF32");
    expect(cpp).toContain("static_cast<u8>(3)");
  });

  test("gpio multi-pin into scope channels", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addGpio("gpio", [0, 1])
        .connect("gpio", "sinks", 0, "s", "out", 0)
        .connect("gpio", "sinks", 1, "s", "out", 1)
        .build(),
    );
    expect(cpp).toContain("GpioInF32");
    expect(cpp).toContain("gpio_p0_items[1] = {s_in[0]}");
    expect(cpp).toContain("gpio_p1_items[1] = {s_in[1]}");
    expect(cpp).toContain("register_gpio_block");
  });

  test("gpio through cos into scope", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addGpio("gpio", [0])
        .connect("gpio", "sinks", 0, "c", "out", 0)
        .connect("c", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp).toContain("gpio_p0_items[1] = {c_in}");
  });

  test("disjoint subgraphs stay independent", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("scope_a")
        .addScope("scope_b")
        .addConstant("const_a", 99)
        .addConstant("const_b", 7)
        .connect("const_a", "downstream", 0, "scope_a", "out", 0)
        .connect("const_b", "downstream", 0, "scope_b", "out", 0)
        .build(),
    );
    expect(cpp).toContain("const_a_dn_items[1] = {scope_a_in[0]}");
    expect(cpp).toContain("const_b_dn_items[1] = {scope_b_in[0]}");
  });

  test("loads diagram_demo.cpp", async () => {
    const diagram = await Diagram.fromCpp(readFileSync(join(here, "../assets/diagram_demo.cpp"), "utf8"), library.palette);
    const cpp = builder.emitDiagram(diagram);
    expect(cpp).toContain("CosGenF32");
    expect(cpp).toContain("ScopeF32");
    expect(cpp).toContain("GpioInF32");
  });

  test("binary tree of products", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p_root")
        .addProduct("p_left")
        .addProduct("p_right")
        .addConstant("c1", 1)
        .addConstant("c2", 2)
        .addConstant("c3", 3)
        .addConstant("c4", 4)
        .connect("c1", "downstream", 0, "p_left", "out", 0)
        .connect("c2", "downstream", 0, "p_left", "out", 1)
        .connect("c3", "downstream", 0, "p_right", "out", 0)
        .connect("c4", "downstream", 0, "p_right", "out", 1)
        .connect("p_left", "downstream", 0, "p_root", "out", 0)
        .connect("p_right", "downstream", 0, "p_root", "out", 1)
        .connect("p_root", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp).toContain("p_left_in");
    expect(cpp).toContain("p_right_in");
    expect(cpp).toContain("p_root_in");
  });

  test("gpio into product with a constant", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addGpio("gpio", [2])
        .addConstant("amp", 2)
        .connect("gpio", "sinks", 0, "p", "out", 0)
        .connect("amp", "downstream", 0, "p", "out", 1)
        .connect("p", "downstream", 0, "s", "out", 0)
        .build(),
    );
    expect(cpp).toContain("gpio_p0_items[1] = {p_in[0]}");
    expect(cpp).toContain("amp_dn_items[1] = {p_in[1]}");
  });

  test("two gpio blocks and two scopes stay independent", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s0")
        .addScope("s1")
        .addGpio("g0", [4])
        .addGpio("g1", [5])
        .connect("g0", "sinks", 0, "s0", "out", 0)
        .connect("g1", "sinks", 0, "s1", "out", 0)
        .build(),
    );
    expect(cpp).toContain("g0_p0_items[1] = {s0_in[0]}");
    expect(cpp).toContain("g1_p0_items[1] = {s1_in[0]}");
    expect(cpp).toContain("register_gpio_block(2u");
    expect(cpp).toContain("register_gpio_block(3u");
  });
});
