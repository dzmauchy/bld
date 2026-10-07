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
} from "../../src";

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
    return this.addBlock(id, "ScopeF32", conf, x, y);
  }

  addConstant(id: string, value: number, x = 100, y = 0): this {
    return this.addBlock(id, "ConstF32", { value }, x, y);
  }

  addCosGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "CosGenF32", conf, x, y);
  }

  addSinGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "SinGenF32", conf, x, y);
  }

  addRandGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "RandGenF32", conf, x, y);
  }

  addPulseGen(id: string, conf?: Record<string, unknown>, x = 100, y = 0): this {
    return this.addBlock(id, "PulseGenF32", conf, x, y);
  }

  addCos(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "CosF32", {}, x, y);
  }

  addSin(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "SinF32", {}, x, y);
  }

  addProduct(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "ProductF32", {}, x, y);
  }

  addSum(id: string, x = 50, y = 0): this {
    return this.addBlock(id, "SumF32", {}, x, y);
  }

  addGpio(id: string, pins: number[] = [0], x = 100, y = 0): this {
    return this.addBlock(id, "GpioInF32", { pins }, x, y);
  }

  connect(
    fromBlock: string,
    _fromPort: string,
    fromVectorIndex: number,
    toBlock: string,
    _toPort: string,
    toVectorIndex: number,
    connId?: string,
  ): this {
    const source = this.blocks[toBlock]!;
    const target = this.blocks[fromBlock]!;
    const output = ["CosF32", "SinF32"].includes(source.ref) ? "consumer" : "channels";
    const input = target.ref === "GpioInF32" ? "pins" : "downstream";
    this.connections[connId ?? `wire_${this.connectionCounter++}`] = {
      from: { block: toBlock, port: { type: "output", id: output, vector_index: toVectorIndex } },
      to: { block: fromBlock, port: { type: "input", id: input, vector_index: fromVectorIndex } },
    };
    return this;
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
    const diagram = Diagram.fromJSON(json, library.palette);
    const result = builder.analyzeSync(diagram);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    for (const block of diagram.getBlocks()) for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
      expect(result.types.get(block.id, port.direction, port.id)).toBeDefined();
    }
    return builder.emitDiagram(diagram);
  }

  test("ConstF32 to ScopeF32", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder().addScope("s").addConstant("c", 42.5).connect("c", "v", 0, "s", "sink", 0).build(),
    );
    expect(cpp).toContain("ConstF32");
    expect(cpp).toContain("static_cast<decltype(value)>(42.5)");
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
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("CosGenF32");
    expect(cpp).toContain("SinGenF32");
  });

  test("rand and pulse generators", () => {
    const cpp = cppOf(
      new DiagramJsonBuilder()
        .addScope("s")
        .addRandGen("r", { amplitude: 2 })
        .addPulseGen("p", { dutyCycle: 0.25, frequency: 4 })
        .connect("r", "v", 0, "s", "sink", 0)
        .connect("p", "v", 0, "s", "sink", 1)
        .build(),
    );
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("RandGenF32");
    expect(cpp).toContain("PulseGenF32");
    expect(cpp).toContain("static_cast<decltype(dutyCycle)>(0.25)");
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
    expect(cpp).toContain("void mount()");
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
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("ProductF32");
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
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("SumF32");
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
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("GpioInF32");
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
    expect(cpp).toContain("void mount()");
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
    expect(cpp).toContain("void mount()");
  });

  test("loads diagram_demo.cpp", async () => {
    const diagram = await Diagram.fromCpp(readFileSync(join(here, "../../assets/diagram_demo.cpp"), "utf8"), library.palette);
    const cpp = builder.emitDiagram(diagram);
    expect(cpp).toContain("CosGenF32");
    expect(cpp).toContain("ScopeF32");
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
    expect(cpp).toContain("void mount()");
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
    expect(cpp).toContain("void mount()");
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
    expect(cpp).toContain("void mount()");
    expect(cpp.match(/register_gpio_block\(blockId/g)).toHaveLength(2);
    expect(cpp).toContain("bld_factory_2(2u)");
    expect(cpp).toContain("bld_factory_3(3u)");
  });
});
