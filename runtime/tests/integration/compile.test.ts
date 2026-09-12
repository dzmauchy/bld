import { describe, expect, test } from "vitest";
import {
  BlockRegistry,
  compileDiagram,
  compileBrowserProgram,
  emitBrowserText,
  emitDiagramText,
  getWasmProfile,
  installLibrary,
  mcuProfile,
  planDiagramJson,
  type DiagramJson,
} from "runtime";
import { install } from "base";
import { instantiateWasm, defaultEnvBindings } from "runtime/run.ts";

const registry = installLibrary(install, new BlockRegistry());

function constToScope(value: number): DiagramJson {
  return {
    id: "const_scope",
    title: "const to scope",
    blocks: {
      s: { ref: "scope_f32", x: 0, y: 0 },
      c: { ref: "const_f32", x: 1, y: 0, conf: { v: value } },
    },
    connections: {
      c__s: {
        from: { block: "c", port: { type: "input", id: "v", vector_index: 0 } },
        to: { block: "s", port: { type: "output", id: "sink", vector_index: 0 } },
      },
    },
  };
}

describe("runtime wasm profiles", () => {
  test("browser profile compiles a diagram from JSON and libraries", async () => {
    const wasm = await compileDiagram({
      diagram: constToScope(3.5),
      libraries: ["memory:base"],
      profile: "browser",
      registry,
    });
    const calls: number[] = [];
    const instance = await instantiateWasm(wasm, {
      ...defaultEnvBindings(),
      sendPinF32(_blockId: number, _pin: number, value: number) {
        calls.push(value);
      },
    });
    (instance.exports.tickThenObserve as () => void)();
    expect(calls).toContain(3.5);
  });

  test("MCU profile is reserved and unimplemented", async () => {
    expect(getWasmProfile("mcu")).toBe(mcuProfile);
    await expect(
      compileDiagram({
        diagram: constToScope(1),
        libraries: [],
        profile: "mcu",
        registry,
      }),
    ).rejects.toThrow(/MCU wasm profile is not implemented/);
  });

  test("emitDiagramText includes browser wasm features", async () => {
    const wat = await emitDiagramText({
      diagram: constToScope(1),
      libraries: [],
      profile: "browser",
      registry,
    });
    expect(wat).toContain("(func $tick");
    expect(wat).toContain("return_call");
    expect(wat).toContain("wasm:js-string");
  });
});

describe("runtime library assembly loading", () => {
  test("loads a library URL and compiles the diagram", async () => {
    const assembly = `
      export function install(api) {
        api.define("scope_f32", {
          push: true,
          tick: true,
          priority: 0,
          emit(block) {
            block.values("nan");
            block.onPush((push) => { push.store(push.channel, push.value); });
            block.onTick(10, (tick) => {
              tick.forRange(tick.arrayLen(), (index) => {
                tick.recordPin(index(), tick.arrayGet(index()));
              });
            });
          },
        });
        api.define("const_f32", {
          tick: true,
          emit(block) {
            block.onTick(10, (tick) => {
              tick.forward(tick.f32(block.confNum("v", 0)));
            });
          },
        });
      }
    `;
    const files: Record<string, string> = {
      "https://libs.example/base.json": JSON.stringify({
        id: "base",
        name: "Base",
        assembly: "assembly.js",
      }),
      "https://libs.example/assembly.js": assembly,
    };
    const wasm = await compileDiagram({
      diagram: constToScope(8),
      libraries: ["https://libs.example/base.json"],
      fetchText: async (url: string) => {
        const content = files[url];
        if (!content) throw new Error(`missing ${url}`);
        return content;
      },
    });
    const instance = await instantiateWasm(wasm);
    (instance.exports.tickThenObserve as () => void)();
    const lastPin = instance.exports.lastPin as (blockId: number, pin: number) => number;
    expect(lastPin(0, 0)).toBe(8);
  });
});

describe("planDiagramJson", () => {
  test("assigns numeric ids and push consumers", () => {
    const program = planDiagramJson(constToScope(1), registry);
    expect(program.blocks).toHaveLength(2);
    expect(program.blocks[0].ref).toBe("scope_f32");
    expect(program.blocks[1].ref).toBe("const_f32");
    expect(program.blocks[1].consumers).toEqual([{ blockId: 0, channel: 0 }]);
  });
});

describe("compileBrowserProgram", () => {
  test("emits text for a planned program", () => {
    const wat = emitBrowserText(
      {
        blocks: [
          { id: 0, ref: "scope_f32", conf: { precision: 10 }, consumers: [], receiveChannels: 1 },
          {
            id: 1,
            ref: "const_f32",
            conf: { precision: 10, v: 1 },
            consumers: [{ blockId: 0, channel: 0 }],
            receiveChannels: 1,
          },
        ],
      },
      { registry },
    );
    expect(wat).toContain("(func $b0_push");
    expect(wat).toContain("(func $b1_tick");
  });

  test("throws for unknown block types", () => {
    expect(() =>
      compileBrowserProgram(
        { blocks: [{ id: 0, ref: "nope", conf: {}, consumers: [], receiveChannels: 1 }] },
        { registry },
      ),
    ).toThrow(/Unknown block type "nope"/);
  });
});
