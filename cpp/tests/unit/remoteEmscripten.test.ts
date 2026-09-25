import { describe, expect, test } from "@rstest/core";
import { RemoteEmscriptenModule } from "../../src/remoteEmscripten.ts";

const wasmMagic = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe("remote emscripten module", () => {
  test("loads the js glue and wasm from the given urls once", async () => {
    const fetches: string[] = [];
    const original = globalThis.fetch;
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
      await factory();
      await factory();
      expect(fetches).toEqual([
        "https://example.test/clang.js",
        "https://example.test/clang.wasm",
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });
});
