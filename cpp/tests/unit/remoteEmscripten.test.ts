import { describe, expect, test } from "vitest";
import { RemoteEmscriptenModule } from "cpp/remoteEmscripten.ts";

const wasmMagic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe("remote emscripten module", () => {
  test("downloads and compiles wasm once across concurrent and subsequent tool boots", async () => {
    const fetches: string[] = [];
    const original = globalThis.fetch;
    const originalCompile = WebAssembly.compile;
    let compilations = 0;
    WebAssembly.compile = async (...args) => {
      compilations += 1;
      return originalCompile(...args);
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetches.push(url);
      if (url.endsWith(".js")) {
        return new Response(
          "export default async function createModule(options) { options.instantiateWasm({}, (instance) => { createModule.instance = instance; }); return { FS: {}, callMain() { return 0; } }; }",
          { status: 200 },
        );
      }
      return new Response(wasmMagic, { status: 200 });
    }) as typeof fetch;
    try {
      const remote = new RemoteEmscriptenModule("https://example.test/clang.js", "https://example.test/clang.wasm");
      const factory = remote.createFactory();
      await Promise.all([factory(), factory()]);
      await factory();
      expect(compilations).toBe(1);
      expect(fetches).toEqual([
        "https://example.test/clang.js",
        "https://example.test/clang.wasm",
      ]);
    } finally {
      globalThis.fetch = original;
      WebAssembly.compile = originalCompile;
    }
  });
});
