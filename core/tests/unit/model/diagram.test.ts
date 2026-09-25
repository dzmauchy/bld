import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "@rstest/core";
import {
  Connection,
  Diagram,
  DiagramBlock,
  DiagramCompiler,
  Library,
  Palette,
  PortEndpoint,
} from "../../../src/model/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const diagramDemoPath = join(coreRoot, "assets/diagram_demo.cpp");

let palette: Palette;

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
});

describe("Palette", () => {
  test("loads all blocks from catalog", () => {
    const blocks = palette.getBlocks();
    expect(blocks.length).toBeGreaterThan(5);

    const scope = palette.getBlock("scope_f32");
    expect(scope).toBeDefined();
    expect(scope?.title).toBe("Scope");
    expect(scope?.category).toBe("sinks");
    expect(scope?.getOutput("out")).toBeDefined();
    expect(scope?.getConfig("period")?.defaultValue).toBe(60);
    expect(scope?.getConfig("precision")?.defaultValue).toBe(10);
  });

  test("filters by category and namespace", () => {
    const sinks = palette.getBlocksByCategory("sinks");
    expect(sinks.map((b) => b.id)).toContain("scope_f32");

    const sources = palette.getBlocksByCategory("sources");
    expect(sources.map((b) => b.id)).toContain("cos_gen_f32");
    expect(sources.map((b) => b.id)).toContain("gpio_in_f32");

    const pushBlocks = palette.getBlocksByNamespace(["push", "f32"]);
    expect(pushBlocks.length).toBeGreaterThan(0);
  });

  test("searches blocks by name or description", () => {
    const results = palette.search("cosine");
    expect(results.map((b) => b.id)).toContain("cos_f32");
  });
});

describe("Diagram & Drag/Drop Blocks", () => {
  test("drags block from palette to diagram at (x, y)", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const block = diagram.addBlock("scope_f32", { x: 100, y: 150 });

    expect(block).toBeInstanceOf(DiagramBlock);
    expect(block.ref).toBe("scope_f32");
    expect(block.x).toBe(100);
    expect(block.y).toBe(150);
    expect(diagram.getBlocks()).toHaveLength(1);
    expect(diagram.getBlock(block.id)).toBe(block);
  });

  test("moves block to new coordinates", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const block = diagram.addBlock("cos_gen_f32", { x: 10, y: 20 });
    diagram.moveBlock(block.id, 50, 75);

    expect(block.x).toBe(50);
    expect(block.y).toBe(75);
  });

  test("removes block and cascades connection removal", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(diagram.getConnections()).toHaveLength(1);

    diagram.removeBlock(scope.id);
    expect(diagram.getBlocks()).toHaveLength(1);
    expect(diagram.getConnections()).toHaveLength(0);
  });
});

describe("Type Checking & Connections", () => {
  test("allows compatible connection between push stream ports", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    const check = diagram.canConnect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(check.ok).toBe(true);

    const conn = diagram.connect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(conn.id).toBeDefined();
    expect(diagram.getConnections()).toHaveLength(1);
  });

  test("allows gpio pin to scope sink because clang++ sees the same stream type", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const gpio = diagram.addBlock("gpio_in_f32", { x: 100, y: 10 });

    const check = diagram.canConnect(
      new PortEndpoint(gpio.id, "input", "sinks", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(check.ok).toBe(true);
  });

  test("rejects connecting block to itself", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const prod = diagram.addBlock("product_f32", { x: 10, y: 10 });

    const check = diagram.canConnect(
      new PortEndpoint(prod.id, "output", "p", 0),
      new PortEndpoint(prod.id, "input", "downstream", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("itself");
  });

  test("rejects duplicate connection", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );

    const check = diagram.canConnect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("already exists");
  });
});

describe("JSON Serialization & Default Omission", () => {
  test("omits default configuration properties from JSON output", () => {
    const diagram = new Diagram("diag_1", "Test", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 20 });

    // Defaults for scope_f32 are period: 60, precision: 10
    expect(scope.toJSON().conf).toBeUndefined();

    // Change precision to non-default
    scope.setConf("precision", 25);
    expect(scope.toJSON().conf).toEqual({ precision: 25 });

    // Change precision back to default
    scope.setConf("precision", 10);
    expect(scope.toJSON().conf).toBeUndefined();
  });

  test("round-trips diagram_demo.cpp through its connection comment", async () => {
    const source = readFileSync(diagramDemoPath, "utf8");
    const diagram = await Diagram.fromCpp(source, palette);
    expect(diagram.id).toBe("2026_09_09T10_11_07_089_7865FB06");
    expect(diagram.title).toBe("Diagram Demo");
    expect(diagram.getBlocks()).toHaveLength(5);
    expect(diagram.getConnections()).toHaveLength(1);
    expect(source).toContain("void mount()");
    expect(source).not.toContain("start(");

    const reloaded = await Diagram.fromCpp(diagram.emitText(new DiagramCompiler({ files: {} })), palette);
    expect(reloaded.toJSON()).toEqual(diagram.toJSON());
  });
});

describe("Wasm Code Generation", () => {
  test("emits a function per block for a connected diagram", () => {
    const diagram = new Diagram("diag_1", "Test", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 30 }, "scope_f32_0", {
      period: 30,
      precision: 11,
    });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 200, y: 20 }, "cos_gen_f32_0", {
      precision: 11,
    });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );

    const cpp = diagram.emitText(new DiagramCompiler({ files: {} }));
    expect(cpp).toContain("void mount()");
    expect(cpp).toContain("ScopeF32");
    expect(cpp).toContain("CosGenF32");
  });

  test("compiles a diagram only when a C++ backend is provided", async () => {
    const diagram = new Diagram("diag_opt", "Options Test", palette);
    await expect(diagram.compile({ debug: false })).rejects.toThrow(/C\+\+ compiler backend is required/);
  });

  test("exposes block lookup, disconnect, and per-block connections", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    expect(diagram.hasBlock(scope.id)).toBe(true);
    expect(diagram.hasBlock("missing")).toBe(false);

    const conn = diagram.connect(
      new PortEndpoint(cosGen.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(diagram.getConnection(conn.id)).toBe(conn);
    expect(diagram.getConnectionsForBlock(scope.id)).toEqual([conn]);
    expect(conn.connectsEndpoint(new PortEndpoint(scope.id, "output", "out", 0))).toBe(true);

    const restored = Connection.fromJSON(conn.id, conn.toJSON());
    expect(restored.from.equals(conn.from)).toBe(true);
    expect(restored.to.equals(conn.to)).toBe(true);

    expect(diagram.disconnect(conn.id)).toBe(true);
    expect(diagram.getConnection(conn.id)).toBeUndefined();
    expect(diagram.getConnectionsForBlock(scope.id)).toHaveLength(0);
  });

  test("exposes diagram block ports, config, and endpoint identity", () => {
    const diagram = new Diagram("diag_1", "Test Diagram", palette);
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 20 }, "scope_0", { precision: 25 });

    expect(scope.getOutputPorts().map((port) => port.id)).toContain("out");
    expect(scope.getInputPorts()).toEqual([]);
    expect(scope.getAllConf()).toMatchObject({ period: 60, precision: 25 });
    expect(scope.definition.getDefaultConfig()).toMatchObject({ period: 60, precision: 10 });

    const endpoint = new PortEndpoint(scope.id, "output", "out", 0);
    expect(endpoint.toString()).toBe(`${scope.id}.output.out[0]`);
  });

  test("forwards compiled wasm to runtime.instantiate in run", async () => {
    const diagram = new Diagram("diag_run_opt", "Run Options Test", palette);
    diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const compiler = new DiagramCompiler({
      cppCompiler: {
        async compile() {
          return wasm;
        },
      },
    });
    let capturedWasm: Uint8Array | undefined;
    const mockSession = { close: async () => 0 } as unknown as import("../../../src/model/compiler").WasmSessionLike;
    const mockRuntime = {
      async instantiate(bytes: Uint8Array) {
        capturedWasm = bytes;
        return mockSession;
      },
    };

    const session = await diagram.run(mockRuntime, compiler);
    expect(session).toBe(mockSession);
    expect(capturedWasm).toBe(wasm);
  });
});

describe("Diagram port type inference", () => {
  test("infers every input and output from clang++ QualTypes", () => {
    const diagram = new Diagram("types", "types", palette);
    const scope = diagram.addBlock("scope_f32", { x: 0, y: 0 }, "scope");
    const cosine = diagram.addBlock("cos_f32", { x: 1, y: 0 }, "cos");
    const constant = diagram.addBlock("const_f32", { x: 2, y: 0 }, "constant");
    const gpio = diagram.addBlock("gpio_in_f32", { x: 3, y: 0 }, "gpio", { pins: [0, 2, 4] });

    const sink = diagram.inferPortType(scope.id, "out", "output");
    expect(sink.isVector).toBe(true);
    expect(sink.qualType).toContain("Vectorized<");
    expect(sink.desugaredQualType).toMatch(/Consumer/);

    const cosOut = diagram.inferPortType(cosine.id, "out", "output");
    expect(cosOut.isVector).toBe(false);
    expect(cosOut.qualType).toMatch(/\*/);

    const cosIn = diagram.inferPortType(cosine.id, "downstream", "input");
    expect(cosIn.isVector).toBe(true);
    expect(cosIn.qualType).toContain("Vectorized<");

    const constIn = diagram.inferPortType(constant.id, "downstream");
    expect(constIn.isVector).toBe(true);
    expect(constIn.qualType).toContain("Vectorized<");

    const pin = diagram.inferPortType(gpio.id, "sinks", "input");
    expect(pin.isVector).toBe(true);
    expect(pin.vectorLength).toBe(3);
    expect(pin.qualType).toContain("Vectorized<");
  });

  test("uses clang++ to accept compatible connections and reject type errors", () => {
    const diagram = new Diagram("wired", "wired", palette);
    const scope = diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
    const constant = diagram.addBlock("const_f32", { x: 1, y: 0 }, "c");
    const allowed = diagram.canConnect(
      new PortEndpoint(constant.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 1),
    );
    expect(allowed.ok).toBe(true);

    diagram.connect(
      new PortEndpoint(constant.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 1),
    );

    const types = diagram.inferPortTypes();
    const from = types.require(constant.id, "input", "downstream");
    const to = types.require(scope.id, "output", "out");
    expect(from.qualType).toContain("Vectorized<");
    expect(to.qualType).toContain("Vectorized<");
    expect(to.vectorLength).toBe(2);
    expect(from.vectorLength).toBe(1);
  });

  test("names the input clang rejected in the dumped AST", () => {
    const diagram = new Diagram("bad", "bad", palette);
    const scope = diagram.addBlock("scope_f64", { x: 0, y: 0 }, "s");
    const constant = diagram.addBlock("const_f32", { x: 1, y: 0 }, "c");
    const check = diagram.canConnect(
      new PortEndpoint(constant.id, "input", "downstream", 0),
      new PortEndpoint(scope.id, "output", "out", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('input "downstream"');
  });
});
