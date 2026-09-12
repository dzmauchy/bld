import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  Diagram,
  DiagramBlock,
  type DiagramJson,
  Palette,
  PortEndpoint,
  TypeSystem,
} from "../../../src/model/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const diagramDemoPath = join(coreRoot, "assets/diagram_demo.json");

describe("Palette", () => {
  test("loads all blocks from catalog", () => {
    const palette = Palette.createDefault();
    const blocks = palette.getBlocks();
    expect(blocks.length).toBeGreaterThan(5);

    const scope = palette.getBlock("scope_f32");
    expect(scope).toBeDefined();
    expect(scope?.title).toBe("Scope");
    expect(scope?.category).toBe("sinks");
    expect(scope?.getOutput("sink")).toBeDefined();
    expect(scope?.getConfig("period")?.defaultValue).toBe(60);
    expect(scope?.getConfig("precision")?.defaultValue).toBe(10);
  });

  test("filters by category and namespace", () => {
    const palette = Palette.createDefault();
    const sinks = palette.getBlocksByCategory("sinks");
    expect(sinks.map((b) => b.id)).toContain("scope_f32");

    const sources = palette.getBlocksByCategory("sources");
    expect(sources.map((b) => b.id)).toContain("cos_gen_f32");
    expect(sources.map((b) => b.id)).toContain("gpio_in");

    const pushBlocks = palette.getBlocksByNamespace(["push", "f32"]);
    expect(pushBlocks.length).toBeGreaterThan(0);
  });

  test("searches blocks by name or description", () => {
    const palette = Palette.createDefault();
    const results = palette.search("cosine");
    expect(results.map((b) => b.id)).toContain("cos_f32");
  });
});

describe("Diagram & Drag/Drop Blocks", () => {
  test("drags block from palette to diagram at (x, y)", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const block = diagram.addBlock("scope_f32", { x: 100, y: 150 });

    expect(block).toBeInstanceOf(DiagramBlock);
    expect(block.ref).toBe("scope_f32");
    expect(block.x).toBe(100);
    expect(block.y).toBe(150);
    expect(diagram.getBlocks()).toHaveLength(1);
    expect(diagram.getBlock(block.id)).toBe(block);
  });

  test("moves block to new coordinates", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const block = diagram.addBlock("cos_gen_f32", { x: 10, y: 20 });
    diagram.moveBlock(block.id, 50, 75);

    expect(block.x).toBe(50);
    expect(block.y).toBe(75);
  });

  test("removes block and cascades connection removal", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    expect(diagram.getConnections()).toHaveLength(1);

    diagram.removeBlock(scope.id);
    expect(diagram.getBlocks()).toHaveLength(1);
    expect(diagram.getConnections()).toHaveLength(0);
  });
});

describe("Type Checking & Connections", () => {
  test("allows compatible connection between push stream ports", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    const check = diagram.canConnect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    expect(check.ok).toBe(true);

    const conn = diagram.connect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    expect(conn.id).toBeDefined();
    expect(diagram.getConnections()).toHaveLength(1);
  });

  test("rejects connection with incompatible types", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const gpio = diagram.addBlock("gpio_in", { x: 100, y: 10 });

    // gpio_in pin is array<pss<f32>>, scope sink is pss<f32>
    const check = diagram.canConnect(
      new PortEndpoint(gpio.id, "input", "pin", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("Incompatible types");

    expect(() =>
      diagram.connect(
        new PortEndpoint(gpio.id, "input", "pin", 0),
        new PortEndpoint(scope.id, "output", "sink", 0),
      ),
    ).toThrow(/Cannot connect/);
  });

  test("rejects connecting block to itself", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const prod = diagram.addBlock("product_f32", { x: 10, y: 10 });

    const check = diagram.canConnect(
      new PortEndpoint(prod.id, "output", "p", 0),
      new PortEndpoint(prod.id, "input", "v", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("itself");
  });

  test("rejects duplicate connection", () => {
    const diagram = new Diagram("diag_1", "Test Diagram");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );

    const check = diagram.canConnect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("already exists");
  });
});

describe("JSON Serialization & Default Omission", () => {
  test("omits default configuration properties from JSON output", () => {
    const diagram = new Diagram("diag_1", "Test");
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

  test("round-trips diagram_demo.json with full fidelity", () => {
    const demoRaw = JSON.parse(readFileSync(diagramDemoPath, "utf8")) as DiagramJson;
    const diagram = Diagram.fromJSON(demoRaw);

    expect(diagram.id).toBe(demoRaw.id);
    expect(diagram.title).toBe(demoRaw.title);
    expect(diagram.getBlocks()).toHaveLength(Object.keys(demoRaw.blocks).length);
    expect(diagram.getConnections()).toHaveLength(Object.keys(demoRaw.connections).length);

    const serialized = diagram.toJSON();
    expect(serialized).toEqual(demoRaw);
  });
});

describe("AssemblyScript Code Generation", () => {
  test("generates valid AssemblyScript for a connected diagram", () => {
    const diagram = new Diagram("diag_1", "Test");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 30 }, "scope_f32_0", {
      period: 30,
      precision: 11,
    });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 200, y: 20 }, "cos_gen_f32_0", {
      precision: 11,
    });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );

    const source = diagram.generateAssemblyScript();
    expect(source).toContain("new scope_f32");
    expect(source).toContain("new cos_gen_f32");
    expect(source).toContain("scope_f32_0.apply()");
    expect(source).toContain("export function tick()");
  });
});
