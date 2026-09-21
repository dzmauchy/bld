import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import { nativeLibraryFiles } from "base";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  type DiagramJson,
  type RawBlockJson,
  type RawConnectionJson,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const builder = new CppDiagramBuilder(nativeLibraryFiles());

export class DiagramJsonBuilder {
  private readonly blocks: Record<string, RawBlockJson> = {};
  private readonly connections: Record<string, RawConnectionJson> = {};
  private connectionCounter = 0;

  constructor(
    public readonly id: string = "e2e_diag",
    public readonly title: string = "E2E Test Diagram",
    public readonly schema: string = "schemas/diagram.schema.json",
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
    const block = this.blocks[blockId];
    if (!block) throw new Error(`Block "${blockId}" not found in builder`);
    if (block.ref === "scope_f32" && portId === "sink") return "output";
    if (block.ref === "product_f32" && portId === "p") return "output";
    if (block.ref === "sum_f32" && portId === "s") return "output";
    if (block.ref === "cos_f32" && portId === "cos") return "output";
    if (block.ref === "sin_f32" && portId === "sin") return "output";
    return "input";
  }

  build(): DiagramJson {
    return {
      $schema: this.schema,
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
  });

  function cppOf(json: DiagramJson): string {
    return builder.emitDiagram(Diagram.fromJSON(json, library.palette));
  }

  test("const_f32 to scope_f32", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder().addScope("s").addConstant("c", 42.5).connect("c", "v", 0, "s", "sink", 0).build(),
    );
    expect(cpp).toContain("ConstF32");
    expect(cpp).toContain("42.5f");
    expect(cpp).toContain("c->apply({s_in[0]})");
  });

  test("cos_gen and sin_gen to a multi-channel scope", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addCosGen("cg")
        .addSinGen("sg")
        .connect("cg", "v", 0, "s", "sink", 0)
        .connect("sg", "v", 0, "s", "sink", 1)
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
        .connect("r", "v", 0, "s", "sink", 0)
        .connect("p", "v", 0, "s", "sink", 1)
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
        .connect("zero", "v", 0, "c", "v", 0)
        .connect("c", "cos", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "s", "sink", 0)
        .build(),
    );
    expect(cpp.indexOf("s->apply(")).toBeLessThan(cpp.indexOf("sn->apply"));
    expect(cpp).toContain("zero->apply({c_in})");
  });

  test("product of two constants", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 3.5)
        .addConstant("c2", 4)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build(),
    );
    expect(cpp).toContain("ProductF32");
    expect(cpp).toContain("p_in = p->apply({s_in[0]}, static_cast<u8>(2))");
  });

  test("sum of three constants", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addSum("sum")
        .addConstant("c1", 1)
        .addConstant("c2", 2)
        .addConstant("c3", 3)
        .connect("c1", "v", 0, "sum", "v", 0)
        .connect("c2", "v", 0, "sum", "v", 1)
        .connect("c3", "v", 0, "sum", "v", 2)
        .connect("sum", "s", 0, "s", "sink", 0)
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
        .connect("gpio", "pin", 0, "s", "sink", 0)
        .connect("gpio", "pin", 1, "s", "sink", 1)
        .build(),
    );
    expect(cpp).toContain("GpioInF32");
    expect(cpp).toContain("gpio->apply({{s_in[0]}, {s_in[1]}})");
    expect(cpp).toContain("register_gpio_block");
  });

  test("gpio through cos into scope", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addGpio("gpio", [0])
        .connect("gpio", "pin", 0, "c", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .build(),
    );
    expect(cpp).toContain("gpio->apply({{c_in}})");
  });

  test("disjoint subgraphs stay independent", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("scope_a")
        .addScope("scope_b")
        .addConstant("const_a", 99)
        .addConstant("const_b", 7)
        .connect("const_a", "v", 0, "scope_a", "sink", 0)
        .connect("const_b", "v", 0, "scope_b", "sink", 0)
        .build(),
    );
    expect(cpp).toContain("const_a->apply({scope_a_in[0]})");
    expect(cpp).toContain("const_b->apply({scope_b_in[0]})");
  });

  test("loads diagram_demo.json", () => {
    const demo = JSON.parse(readFileSync(join(here, "../assets/diagram_demo.json"), "utf8")) as DiagramJson;
    const cpp = cppOf(demo);
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
        .connect("c1", "v", 0, "p_left", "v", 0)
        .connect("c2", "v", 0, "p_left", "v", 1)
        .connect("c3", "v", 0, "p_right", "v", 0)
        .connect("c4", "v", 0, "p_right", "v", 1)
        .connect("p_left", "p", 0, "p_root", "v", 0)
        .connect("p_right", "p", 0, "p_root", "v", 1)
        .connect("p_root", "p", 0, "s", "sink", 0)
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
        .connect("gpio", "pin", 0, "p", "v", 0)
        .connect("amp", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build(),
    );
    expect(cpp).toContain("gpio->apply({{p_in[0]}})");
    expect(cpp).toContain("amp->apply({p_in[1]})");
  });

  test("two gpio blocks and two scopes stay independent", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s0")
        .addScope("s1")
        .addGpio("g0", [4])
        .addGpio("g1", [5])
        .connect("g0", "pin", 0, "s0", "sink", 0)
        .connect("g1", "pin", 0, "s1", "sink", 0)
        .build(),
    );
    expect(cpp).toContain("g0->apply({{s0_in[0]}})");
    expect(cpp).toContain("g1->apply({{s1_in[0]}})");
    expect(cpp).toContain("register_gpio_block(2u");
    expect(cpp).toContain("register_gpio_block(3u");
  });
});
