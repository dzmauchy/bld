import { afterAll, describe, expect, test } from "vitest";
import { createNodeWasmRuntime } from "runtime/tests/runtime.node.ts";
import { BlockRegistry, browserProfile } from "runtime";
import {
  DefaultDiagramPlanner,
  Diagram,
  DiagramCompiler,
  Library,
  Palette,
  PortEndpoint,
  type TypeCatalogEntry,
} from "../../src";

const runtime = createNodeWasmRuntime();

afterAll(async () => {
  await runtime.close();
});

describe("Library assembly dynamic import code injection into wasm", () => {
  test("dynamically imports assembly and uses functions to inject block code into diagram wasm", async () => {
    const registry = new BlockRegistry();

    // Standard types
    const types: Record<string, TypeCatalogEntry> = {
      f32: { name: "Float 32", description: "32-bit floating point" },
    };

    const blocks = {
      sink_block: {
        title: "Sink Block",
        category: "sinks",
        inputs: { in: { type: "f32" } },
        outputs: {},
        conf: {},
      },
      quad_block: {
        title: "Quadruple Block",
        category: "transformers",
        inputs: { in: { type: "f32" } },
        outputs: { out: { type: "f32" } },
        conf: {},
      },
      const_source: {
        title: "Constant Source",
        category: "sources",
        inputs: {},
        outputs: { out: { type: "f32" } },
        conf: { val: { type: "f32", default: 7.0 } },
      },
    };

    const lib = await Library.load(
      {
        id: "custom_dynamic_lib",
        name: "Custom Dynamic Library",
        assembly: "https://example.com/dsp/custom_assembly.js",
      },
      {
        registry,
        importModule: async (url) => {
          expect(url).toBe("https://example.com/dsp/custom_assembly.js");
          return {
            install: (api) => {
              // Sink block: stores incoming value and records pin
              api.define("sink_block", (block) => {
                block.values("zero");
                block.onPush((push) => {
                  push.storeAndRecord();
                });
              });

              // Quad block: multiplies incoming value by 4 and forwards downstream
              api.defineUnary("quad_block", (push, val) => push.mul(val, push.f32(4)));

              // Source block: generates constant 7 on tick
              api.defineGenerator("const_source", (tick) => tick.f32(7));
            },
          };
        },
      },
    );

    expect(lib.assembly).toBe("https://example.com/dsp/custom_assembly.js");
    expect(registry.has("sink_block")).toBe(true);
    expect(registry.has("quad_block")).toBe(true);
    expect(registry.has("const_source")).toBe(true);

    const palette = Palette.fromCatalog(blocks, types);
    const diagram = new Diagram("dynamic_test", "Dynamic Test Diagram", palette);

    const src = diagram.addBlock("const_source", { x: 0, y: 0 }, "src_0");
    const quad = diagram.addBlock("quad_block", { x: 50, y: 0 }, "quad_0");
    const sink = diagram.addBlock("sink_block", { x: 100, y: 0 }, "sink_0");

    diagram.connect(
      new PortEndpoint(src.id, "output", "out", 0),
      new PortEndpoint(quad.id, "input", "in", 0),
    );
    diagram.connect(
      new PortEndpoint(quad.id, "output", "out", 0),
      new PortEndpoint(sink.id, "input", "in", 0),
    );

    const compiler = new DiagramCompiler(
      browserProfile,
      undefined,
      new DefaultDiagramPlanner(registry),
    );

    const session = await diagram.run(runtime, compiler);
    try {
      await session.tickThenObserve();
      const sinkBlockNumId = diagram.getBlocks().findIndex((b) => b.id === sink.id);
      expect(await session.lastPin(sinkBlockNumId, 0)).toBe(28); // 7 * 4 = 28
    } finally {
      await session.close();
    }
  });
});
