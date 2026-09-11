import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  BrowserCompiler,
  Diagram,
  Library,
  type DiagramJson,
  type RawBlockJson,
  type RawConnectionJson,
  type WasmRuntimeLike,
  type WasmSessionLike,
} from "../src";
import { createNodeWasmRuntime } from "runtime/runtime.node.ts";
import { compileDiagram } from "runtime/compile.ts";
import { importAssembly } from "runtime";

const here = dirname(fileURLToPath(import.meta.url));
const baseManifestPath = join(here, "../assets/base.json");
const baseManifestJson = readFileSync(baseManifestPath, "utf8");
const assemblyPath = join(here, "../../base/dist/assembly.js");
const assemblyUrl = pathToFileURL(assemblyPath).href;

// --- Object-Oriented Test Architecture ---

/**
 * Fluent builder for constructing valid DiagramJson specifications.
 */
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

  addConstant(id: string, value: number, precision?: number, x = 100, y = 0): this {
    return this.addBlock(id, "const_f32", { v: value, ...(precision !== undefined ? { precision } : {}) }, x, y);
  }

  addCosGen(id: string, precision?: number, x = 100, y = 0): this {
    return this.addBlock(id, "cos_gen_f32", precision !== undefined ? { precision } : {}, x, y);
  }

  addSinGen(id: string, precision?: number, x = 100, y = 0): this {
    return this.addBlock(id, "sin_gen_f32", precision !== undefined ? { precision } : {}, x, y);
  }

  addRandGen(id: string, precision?: number, x = 100, y = 0): this {
    return this.addBlock(id, "rand_gen_f32", precision !== undefined ? { precision } : {}, x, y);
  }

  addPulseGen(id: string, conf?: { period?: number; duty_cycle?: number }, x = 100, y = 0): this {
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

  addGpio(id: string, pins: number[] = [0], x = 100, y = 0): this {
    return this.addBlock(id, "gpio_in", { pins }, x, y);
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

/**
 * Base execution harness encapsulating runtime, library, and execution lifecycles.
 */
export abstract class DiagramExecutionHarness {
  constructor(
    protected readonly runtime: WasmRuntimeLike,
    protected readonly library: Library,
  ) {}

  abstract execute(diagramJson: DiagramJson): Promise<WasmSessionLike>;

  protected getBlockNumericId(diagramJson: DiagramJson, blockId: string): number {
    const index = Object.keys(diagramJson.blocks).indexOf(blockId);
    if (index === -1) throw new Error(`Block ${blockId} not found in diagram blocks`);
    return index;
  }

  async runSingleValue(
    diagramJson: DiagramJson,
    scopeBlockId: string,
    channel = 0,
    timeMs?: number,
  ): Promise<number> {
    const session = await this.execute(diagramJson);
    try {
      if (timeMs !== undefined) await session.setNow(timeMs);
      await session.tickThenObserve();
      const scopeNumId = this.getBlockNumericId(diagramJson, scopeBlockId);
      return await session.lastPin(scopeNumId, channel);
    } finally {
      await session.close();
    }
  }

  async runMultiChannel(
    diagramJson: DiagramJson,
    scopeBlockId: string,
    channels: number[],
    timeMs?: number,
  ): Promise<number[]> {
    const session = await this.execute(diagramJson);
    try {
      if (timeMs !== undefined) await session.setNow(timeMs);
      await session.tickThenObserve();
      const scopeNumId = this.getBlockNumericId(diagramJson, scopeBlockId);
      return await Promise.all(channels.map((ch) => session.lastPin(scopeNumId, ch)));
    } finally {
      await session.close();
    }
  }

  async openSession(diagramJson: DiagramJson): Promise<{
    session: WasmSessionLike;
    scopeId: (blockId: string) => number;
    close: () => Promise<void>;
  }> {
    const session = await this.execute(diagramJson);
    return {
      session,
      scopeId: (blockId: string) => this.getBlockNumericId(diagramJson, blockId),
      close: async () => {
        await session.close();
      },
    };
  }
}

/**
 * Executes diagrams via Diagram.fromJSON() and diagram.run().
 */
export class ModelDiagramHarness extends DiagramExecutionHarness {
  private readonly compiler = new BrowserCompiler();

  async execute(diagramJson: DiagramJson): Promise<WasmSessionLike> {
    const diagram = Diagram.fromJSON(diagramJson, this.library.palette);
    return diagram.run(this.runtime, this.compiler);
  }
}

/**
 * Executes diagrams directly via compileDiagram() and raw manifest URLs.
 */
export class ManifestCompileHarness extends DiagramExecutionHarness {
  constructor(
    runtime: WasmRuntimeLike,
    library: Library,
    private readonly manifestContent: string,
    private readonly bundleUrl: string,
  ) {
    super(runtime, library);
  }

  async execute(diagramJson: DiagramJson): Promise<WasmSessionLike> {
    const wasm = await compileDiagram({
      diagram: diagramJson,
      libraries: ["https://lib.bld.local/base.json"],
      profile: "browser",
      fetchText: async (url) => {
        if (url.includes("base.json")) return this.manifestContent;
        throw new Error(`Unknown URL: ${url}`);
      },
      importModule: async () => importAssembly(this.bundleUrl),
    });
    return this.runtime.instantiate(wasm);
  }
}

// --- Test Suites ---

describe("E2E Diagram Execution with JSON and Library", () => {
  const runtime = createNodeWasmRuntime();
  let library: Library;
  let modelHarness: ModelDiagramHarness;
  let manifestHarness: ManifestCompileHarness;

  beforeAll(async () => {
    library = await Library.load("base.json");
    modelHarness = new ModelDiagramHarness(runtime, library);
    manifestHarness = new ManifestCompileHarness(runtime, library, baseManifestJson, assemblyUrl);
  });

  afterAll(async () => {
    await runtime.close();
  });

  describe("Suite 1: Single Generator Sources to Scope", () => {
    test("const_f32 positive value propagates to scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addConstant("c", 42.5)
        .connect("c", "v", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(42.5);
    });

    test("const_f32 negative fractional value propagates to scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addConstant("c", -123.456)
        .connect("c", "v", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(-123.456, 3);
    });

    test("cos_gen_f32 produces cosine wave across time steps", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCosGen("g")
        .connect("g", "v", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        // t = 0 -> cos(0) = 1.0
        await session.setNow(0);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(1.0, 4);

        // t = 1000ms (1 rad) -> cos(1)
        await session.setNow(1000);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(Math.cos(1), 4);

        // t = 3141.59ms (pi rad) -> cos(pi) = -1.0
        await session.setNow(3141.59265);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(-1.0, 3);
      } finally {
        await close();
      }
    });

    test("sin_gen_f32 produces sine wave across time steps", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addSinGen("g")
        .connect("g", "v", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        // t = 0 -> sin(0) = 0.0
        await session.setNow(0);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(0.0, 4);

        // t = 1570.796ms (pi/2) -> sin(pi/2) = 1.0
        await session.setNow(1570.796);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(1.0, 3);
      } finally {
        await close();
      }
    });

    test("rand_gen_f32 outputs injected random float", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addRandGen("g")
        .connect("g", "v", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        await session.setRandom(0.732);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(0.732, 3);

        await session.setRandom(0.125);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(0.125, 3);
      } finally {
        await close();
      }
    });

    test("pulse_gen_f32 switches between high (1) and low (0) based on duty window", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addPulseGen("p", { period: 20, duty_cycle: 0.25 })
        .connect("p", "v", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        // t = 0 -> within duty window (20 * 0.25 = 5ms) -> 1
        await session.setNow(0);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1);

        // t = 4ms -> still inside duty window -> 1
        await session.setNow(4);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1);

        // t = 6ms -> past duty window -> 0
        await session.setNow(6);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(0);

        // t = 20ms -> next period start -> 1
        await session.setNow(20);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 2: Unary Transform Pipelines & Deep Chaining", () => {
    test("const(0) -> cos_f32 -> scope produces 1.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "c", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(1.0);
    });

    test("const(0) -> sin_f32 -> scope produces 0.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addSin("sn")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(0.0);
    });

    test("linear unary chain: const(0) -> cos_f32 -> sin_f32 -> scope produces sin(1)", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addSin("sn")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "c", "v", 0)
        .connect("c", "cos", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(Math.sin(1), 5);
    });

    test("inverted unary chain: const(0) -> sin_f32 -> cos_f32 -> scope produces cos(0) = 1.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addSin("sn")
        .addCos("c")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "c", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(1.0);
    });

    test("deep 4-stage chain: const(0) -> cos -> sin -> cos -> scope", async () => {
      // cos(0) = 1 -> sin(1) = 0.84147... -> cos(sin(1)) = 0.666366...
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c1")
        .addSin("sn1")
        .addCos("c2")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "c1", "v", 0)
        .connect("c1", "cos", 0, "sn1", "v", 0)
        .connect("sn1", "sin", 0, "c2", "v", 0)
        .connect("c2", "cos", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      const expected = Math.cos(Math.sin(Math.cos(0)));
      expect(val).toBeCloseTo(expected, 5);
    });

    test("time generator into unary transform: cos_gen_f32 -> sin_f32 -> scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addSin("sn")
        .addCosGen("g")
        .connect("g", "v", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "s", "sink", 0)
        .build();

      // At t = 0, cos_gen produces 1.0; sin(1.0) ~ 0.84147
      const val = await modelHarness.runSingleValue(diag, "s", 0, 0);
      expect(val).toBeCloseTo(Math.sin(1.0), 5);
    });
  });

  describe("Suite 3: Multi-Input Product Combinations", () => {
    test("product_f32 of two constants: 3.5 * 4.0 = 14.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 3.5)
        .addConstant("c2", 4.0)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(14.0);
    });

    test("product_f32 of 3 constants: 2 * 3 * 4 = 24.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 2)
        .addConstant("c2", 3)
        .addConstant("c3", 4)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("c3", "v", 0, "p", "v", 2)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(24.0);
    });

    test("product_f32 of 4 constants: 2 * 3 * 5 * 7 = 210.0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 2)
        .addConstant("c2", 3)
        .addConstant("c3", 5)
        .addConstant("c4", 7)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("c3", "v", 0, "p", "v", 2)
        .connect("c4", "v", 0, "p", "v", 3)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(210.0);
    });

    test("constant gain amplifier: const(10) * cos_gen_f32", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("gain", 10)
        .addCosGen("gen")
        .connect("gain", "v", 0, "p", "v", 0)
        .connect("gen", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0, 0);
      expect(val).toBeCloseTo(10.0, 4);
    });

    test("dual generator balanced modulator: cos_gen * sin_gen", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addCosGen("cg")
        .addSinGen("sg")
        .connect("cg", "v", 0, "p", "v", 0)
        .connect("sg", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0, 1000);
      expect(val).toBeCloseTo(Math.cos(1) * Math.sin(1), 4);
    });

    test("cascaded products: (c1 * c2) * (c3 * c4) = (2 * 3) * (4 * 5) = 120", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p_final")
        .addProduct("p1")
        .addProduct("p2")
        .addConstant("c1", 2)
        .addConstant("c2", 3)
        .addConstant("c3", 4)
        .addConstant("c4", 5)
        .connect("c1", "v", 0, "p1", "v", 0)
        .connect("c2", "v", 0, "p1", "v", 1)
        .connect("c3", "v", 0, "p2", "v", 0)
        .connect("c4", "v", 0, "p2", "v", 1)
        .connect("p1", "p", 0, "p_final", "v", 0)
        .connect("p2", "p", 0, "p_final", "v", 1)
        .connect("p_final", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(120.0);
    });
  });

  describe("Suite 4: Fan-out Topologies", () => {
    test("1 generator fans out to 3 channels of same scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addConstant("c", 77.5)
        .connect("c", "v", 0, "s", "sink", 0)
        .connect("c", "v", 0, "s", "sink", 1)
        .connect("c", "v", 0, "s", "sink", 2)
        .build();

      const channels = await modelHarness.runMultiChannel(diag, "s", [0, 1, 2]);
      expect(channels).toEqual([77.5, 77.5, 77.5]);
    });

    test("self-squaring: single constant fans out to both inputs of product_f32 (x * x)", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c", 6)
        .connect("c", "v", 0, "p", "v", 0)
        .connect("c", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(36.0);
    });

    test("source fans out to parallel independent unary transforms into dual scope channels", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addSin("sn")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "c", "v", 0)
        .connect("zero", "v", 0, "sn", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .connect("sn", "sin", 0, "s", "sink", 1)
        .build();

      const channels = await modelHarness.runMultiChannel(diag, "s", [0, 1]);
      expect(channels[0]).toBe(1.0); // cos(0)
      expect(channels[1]).toBe(0.0); // sin(0)
    });
  });

  describe("Suite 5: Diamond & Re-convergent Graph Topologies", () => {
    test("diamond graph: const(0) splits to cos and sin, converging into product: 1 * 0 = 0", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addCos("c")
        .addSin("sn")
        .addConstant("zero", 0)
        .connect("zero", "v", 0, "c", "v", 0)
        .connect("zero", "v", 0, "sn", "v", 0)
        .connect("c", "cos", 0, "p", "v", 0)
        .connect("sn", "sin", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(0.0);
    });

    test("non-zero diamond: const(0.5) splits to cos and sin, converging into product", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addCos("c")
        .addSin("sn")
        .addConstant("theta", 0.5)
        .connect("theta", "v", 0, "c", "v", 0)
        .connect("theta", "v", 0, "sn", "v", 0)
        .connect("c", "cos", 0, "p", "v", 0)
        .connect("sn", "sin", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      const expected = Math.cos(0.5) * Math.sin(0.5);
      expect(val).toBeCloseTo(expected, 5);
    });

    test("product feeding unary transform: (c1 * c2) -> cos -> scope", async () => {
      // 2 * 0.5 = 1.0 -> cos(1.0)
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addProduct("p")
        .addConstant("c1", 2.0)
        .addConstant("c2", 0.5)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "c", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(Math.cos(1.0), 5);
    });

    test("pulse-gated waveform: pulse_gen * sin_gen -> product -> scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addPulseGen("pulse", { period: 100, duty_cycle: 0.5 })
        .addSinGen("sin")
        .connect("pulse", "v", 0, "p", "v", 0)
        .connect("sin", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        // t = 10ms: pulse is HIGH (1), sin(10ms = 0.01s)
        await session.setNow(10);
        await session.tickThenObserve();
        const highVal = await session.lastPin(sId, 0);
        expect(highVal).toBeCloseTo(Math.sin(0.01), 4);

        // t = 75ms: pulse is LOW (0), 0 * sin(...) = 0
        await session.setNow(75);
        await session.tickThenObserve();
        const lowVal = await session.lastPin(sId, 0);
        expect(lowVal).toBe(0.0);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 6: Multiple Disjoint Subgraphs in Single Diagram", () => {
    test("independent subgraphs execute simultaneously without crosstalk", async () => {
      // Subgraph A: const_a (99) -> scope_a
      // Subgraph B: const_b1 (3) * const_b2 (7) -> product_b -> scope_b
      // Subgraph C: const_c (0) -> cos_c -> scope_c
      const diag = new DiagramJsonBuilder()
        .addScope("scope_a")
        .addScope("scope_b")
        .addScope("scope_c")
        .addConstant("const_a", 99)
        .addProduct("prod_b")
        .addConstant("const_b1", 3)
        .addConstant("const_b2", 7)
        .addCos("cos_c")
        .addConstant("const_c", 0)
        // Connections for Subgraph A
        .connect("const_a", "v", 0, "scope_a", "sink", 0)
        // Connections for Subgraph B
        .connect("const_b1", "v", 0, "prod_b", "v", 0)
        .connect("const_b2", "v", 0, "prod_b", "v", 1)
        .connect("prod_b", "p", 0, "scope_b", "sink", 0)
        // Connections for Subgraph C
        .connect("const_c", "v", 0, "cos_c", "v", 0)
        .connect("cos_c", "cos", 0, "scope_c", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        await session.tickThenObserve();
        const valA = await session.lastPin(scopeId("scope_a"), 0);
        const valB = await session.lastPin(scopeId("scope_b"), 0);
        const valC = await session.lastPin(scopeId("scope_c"), 0);

        expect(valA).toBe(99);
        expect(valB).toBe(21);
        expect(valC).toBe(1.0);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 7: Demo Asset JSON Execution", () => {
    test("loads and executes diagram_demo.json with base.json library", async () => {
      const demoPath = join(here, "../assets/diagram_demo.json");
      const demoContent = readFileSync(demoPath, "utf8");
      const demoJson = JSON.parse(demoContent) as DiagramJson;

      const { session, scopeId, close } = await modelHarness.openSession(demoJson);
      try {
        const sId = scopeId("scope_f32_0");

        // In diagram_demo.json, cos_gen_f32_0 is connected to scope_f32_0 sink[0]
        await session.setNow(0);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(1.0, 4);

        await session.setNow(1000);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(Math.cos(1), 4);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 8: Low-level ManifestCompileHarness E2E Execution", () => {
    test("manifest-based compilation of arithmetic pipeline via compileDiagram", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("a", 12.5)
        .addConstant("b", 8.0)
        .connect("a", "v", 0, "p", "v", 0)
        .connect("b", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await manifestHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(100.0);
    });

    test("manifest-based compilation of chained unary blocks via compileDiagram", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addSin("sn")
        .addConstant("val", 0)
        .connect("val", "v", 0, "c", "v", 0)
        .connect("c", "cos", 0, "sn", "v", 0)
        .connect("sn", "sin", 0, "s", "sink", 0)
        .build();

      const val = await manifestHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(Math.sin(1), 5);
    });

    test("manifest-based compilation with GPIO input events", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addGpio("gpio", [0, 1])
        .connect("gpio", "pin", 0, "s", "sink", 0)
        .connect("gpio", "pin", 1, "s", "sink", 1)
        .build();

      const { session, scopeId, close } = await manifestHarness.openSession(diag);
      try {
        const sId = scopeId("s");
        const gpioNumId = scopeId("gpio");

        // Emit true on pin 0 -> scope channel 0 becomes 1
        await session.emitGpioIn(gpioNumId, 0, true);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1);

        // Emit false on pin 1 -> scope channel 1 becomes 0
        await session.emitGpioIn(gpioNumId, 1, false);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 1)).toBe(0);
      } finally {
        await close();
      }
    });

    test("gpio input through unary cos into scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addGpio("gpio", [0])
        .connect("gpio", "pin", 0, "c", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await manifestHarness.openSession(diag);
      try {
        const sId = scopeId("s");
        const gpioNumId = scopeId("gpio");

        // Emit false (0) on pin 0 -> cos(0) = 1.0 on scope
        await session.emitGpioIn(gpioNumId, 0, false);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1.0);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 9: Binary Tree & Multi-Layer Cascade Topologies", () => {
    test("8-input binary tree of product blocks: (c1*c2)*(c3*c4) * (c5*c6)*(c7*c8) = 40320", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p_root")
        .addProduct("p_left")
        .addProduct("p_right")
        .addProduct("p1")
        .addProduct("p2")
        .addProduct("p3")
        .addProduct("p4")
        .addConstant("c1", 1)
        .addConstant("c2", 2)
        .addConstant("c3", 3)
        .addConstant("c4", 4)
        .addConstant("c5", 5)
        .addConstant("c6", 6)
        .addConstant("c7", 7)
        .addConstant("c8", 8)
        // layer 1
        .connect("c1", "v", 0, "p1", "v", 0)
        .connect("c2", "v", 0, "p1", "v", 1)
        .connect("c3", "v", 0, "p2", "v", 0)
        .connect("c4", "v", 0, "p2", "v", 1)
        .connect("c5", "v", 0, "p3", "v", 0)
        .connect("c6", "v", 0, "p3", "v", 1)
        .connect("c7", "v", 0, "p4", "v", 0)
        .connect("c8", "v", 0, "p4", "v", 1)
        // layer 2
        .connect("p1", "p", 0, "p_left", "v", 0)
        .connect("p2", "p", 0, "p_left", "v", 1)
        .connect("p3", "p", 0, "p_right", "v", 0)
        .connect("p4", "p", 0, "p_right", "v", 1)
        // root
        .connect("p_left", "p", 0, "p_root", "v", 0)
        .connect("p_right", "p", 0, "p_root", "v", 1)
        .connect("p_root", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(40320);
    });

    test("6-input wide product block: 2 * 3 * 4 * 5 * 6 * 7 = 5040", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("c1", 2)
        .addConstant("c2", 3)
        .addConstant("c3", 4)
        .addConstant("c4", 5)
        .addConstant("c5", 6)
        .addConstant("c6", 7)
        .connect("c1", "v", 0, "p", "v", 0)
        .connect("c2", "v", 0, "p", "v", 1)
        .connect("c3", "v", 0, "p", "v", 2)
        .connect("c4", "v", 0, "p", "v", 3)
        .connect("c5", "v", 0, "p", "v", 4)
        .connect("c6", "v", 0, "p", "v", 5)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(5040);
    });

    test("feed-forward graph: (A * B) * A = A^2 * B", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p1")
        .addProduct("p2")
        .addConstant("a", 3)
        .addConstant("b", 4)
        .connect("a", "v", 0, "p1", "v", 0)
        .connect("b", "v", 0, "p1", "v", 1)
        .connect("p1", "p", 0, "p2", "v", 0)
        .connect("a", "v", 0, "p2", "v", 1)
        .connect("p2", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBe(36);
    });
  });

  describe("Suite 10: Trigonometric Identities and Modulation Topologies", () => {
    test("double angle sine identity: 2 * sin(theta) * cos(theta) = sin(2 * theta)", async () => {
      const theta = 0.35;
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("two", 2.0)
        .addConstant("theta", theta)
        .addSin("sn")
        .addCos("cs")
        .connect("two", "v", 0, "p", "v", 0)
        .connect("theta", "v", 0, "sn", "v", 0)
        .connect("theta", "v", 0, "cs", "v", 0)
        .connect("sn", "sin", 0, "p", "v", 1)
        .connect("cs", "cos", 0, "p", "v", 2)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(Math.sin(2 * theta), 5);
    });

    test("squaring cosine: cos(theta) * cos(theta) = cos^2(theta)", async () => {
      const theta = 0.8;
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("theta", theta)
        .addCos("cs")
        .connect("theta", "v", 0, "cs", "v", 0)
        .connect("cs", "cos", 0, "p", "v", 0)
        .connect("cs", "cos", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const val = await modelHarness.runSingleValue(diag, "s", 0);
      expect(val).toBeCloseTo(Math.cos(theta) ** 2, 5);
    });

    test("pulse-gated cosine wave generator", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addPulseGen("pulse", { period: 50, duty_cycle: 0.4 })
        .addCosGen("cos_gen")
        .connect("pulse", "v", 0, "p", "v", 0)
        .connect("cos_gen", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        const sId = scopeId("s");

        // t = 10ms: pulse is 1, cos(10ms = 0.01 rad)
        await session.setNow(10);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(Math.cos(0.01), 4);

        // t = 30ms: pulse is 0
        await session.setNow(30);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(0.0);
      } finally {
        await close();
      }
    });
  });

  describe("Suite 11: Multi-Channel Scopes and Structural Topologies", () => {
    test("4-channel heterogeneous scope receiving from 4 distinct pipeline branches", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addConstant("c_raw", 12.34)
        .addCosGen("c_gen")
        .addProduct("p")
        .addConstant("p_a", 3)
        .addConstant("p_b", 7)
        .addCos("cos_unary")
        .addConstant("zero", 0)
        .connect("c_raw", "v", 0, "s", "sink", 0)
        .connect("c_gen", "v", 0, "s", "sink", 1)
        .connect("p_a", "v", 0, "p", "v", 0)
        .connect("p_b", "v", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 2)
        .connect("zero", "v", 0, "cos_unary", "v", 0)
        .connect("cos_unary", "cos", 0, "s", "sink", 3)
        .build();

      const chs = await modelHarness.runMultiChannel(diag, "s", [0, 1, 2, 3], 0);
      expect(chs[0]).toBeCloseTo(12.34, 4);
      expect(chs[1]).toBeCloseTo(1.0, 4);
      expect(chs[2]).toBe(21.0);
      expect(chs[3]).toBe(1.0);
    });

    test("dual scope isolation: two scopes in single diagram monitor different endpoints independently", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("scope1")
        .addScope("scope2")
        .addConstant("c1", 100)
        .addConstant("c2", 200)
        .connect("c1", "v", 0, "scope1", "sink", 0)
        .connect("c2", "v", 0, "scope2", "sink", 0)
        .build();

      const { session, scopeId, close } = await modelHarness.openSession(diag);
      try {
        await session.tickThenObserve();
        expect(await session.lastPin(scopeId("scope1"), 0)).toBe(100);
        expect(await session.lastPin(scopeId("scope2"), 0)).toBe(200);
      } finally {
        await close();
      }
    });

    test("topological independence from JSON key insertion order (scope declared last)", async () => {
      const diag: DiagramJson = {
        id: "unordered_diag",
        title: "Unordered Keys",
        blocks: {
          gen_a: { ref: "const_f32", x: 10, y: 10, conf: { v: 55 } },
          gen_b: { ref: "const_f32", x: 10, y: 50, conf: { v: 2 } },
          prod: { ref: "product_f32", x: 60, y: 30 },
          scope_last: { ref: "scope_f32", x: 120, y: 30 },
        },
        connections: {
          c1: {
            from: { block: "gen_a", port: { type: "input", id: "v", vector_index: 0 } },
            to: { block: "prod", port: { type: "input", id: "v", vector_index: 0 } },
          },
          c2: {
            from: { block: "gen_b", port: { type: "input", id: "v", vector_index: 0 } },
            to: { block: "prod", port: { type: "input", id: "v", vector_index: 1 } },
          },
          c3: {
            from: { block: "prod", port: { type: "output", id: "p", vector_index: 0 } },
            to: { block: "scope_last", port: { type: "output", id: "sink", vector_index: 0 } },
          },
        },
      };

      const val = await modelHarness.runSingleValue(diag, "scope_last", 0);
      expect(val).toBe(110);
    });
  });

  describe("Suite 12: Combinational GPIO & Hybrid Topologies", () => {
    test("GPIO multi-pin AND logic with product: pins 0 and 1", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addGpio("gpio", [0, 1])
        .connect("gpio", "pin", 0, "p", "v", 0)
        .connect("gpio", "pin", 1, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await manifestHarness.openSession(diag);
      try {
        const sId = scopeId("s");
        const gpioNumId = scopeId("gpio");

        // Both true: 1 * 1 = 1
        await session.emitGpioIn(gpioNumId, 0, true);
        await session.emitGpioIn(gpioNumId, 1, true);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1);

        // One false: 1 * 0 = 0
        await session.emitGpioIn(gpioNumId, 1, false);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(0);
      } finally {
        await close();
      }
    });

    test("GPIO pin fan-out to parallel cos and sin blocks", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addCos("c")
        .addSin("sn")
        .addGpio("gpio", [0])
        .connect("gpio", "pin", 0, "c", "v", 0)
        .connect("gpio", "pin", 0, "sn", "v", 0)
        .connect("c", "cos", 0, "s", "sink", 0)
        .connect("sn", "sin", 0, "s", "sink", 1)
        .build();

      const { session, scopeId, close } = await manifestHarness.openSession(diag);
      try {
        const sId = scopeId("s");
        const gpioNumId = scopeId("gpio");

        // Emit true (1.0): cos(1.0) and sin(1.0)
        await session.emitGpioIn(gpioNumId, 0, true);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBeCloseTo(Math.cos(1.0), 5);
        expect(await session.lastPin(sId, 1)).toBeCloseTo(Math.sin(1.0), 5);

        // Emit false (0.0): cos(0) = 1.0 and sin(0) = 0.0
        await session.emitGpioIn(gpioNumId, 0, false);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(1.0);
        expect(await session.lastPin(sId, 1)).toBe(0.0);
      } finally {
        await close();
      }
    });

    test("GPIO pin scaled by constant gain amplifier: gpio * gain(5.5) -> scope", async () => {
      const diag = new DiagramJsonBuilder()
        .addScope("s")
        .addProduct("p")
        .addConstant("gain", 5.5)
        .addGpio("gpio", [0])
        .connect("gain", "v", 0, "p", "v", 0)
        .connect("gpio", "pin", 0, "p", "v", 1)
        .connect("p", "p", 0, "s", "sink", 0)
        .build();

      const { session, scopeId, close } = await manifestHarness.openSession(diag);
      try {
        const sId = scopeId("s");
        const gpioNumId = scopeId("gpio");

        await session.emitGpioIn(gpioNumId, 0, true);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(5.5);

        await session.emitGpioIn(gpioNumId, 0, false);
        await session.tickThenObserve();
        expect(await session.lastPin(sId, 0)).toBe(0.0);
      } finally {
        await close();
      }
    });
  });
});

