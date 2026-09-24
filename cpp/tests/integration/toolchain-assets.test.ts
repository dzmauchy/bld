import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const assets = join(dirname(fileURLToPath(import.meta.url)), "../../assets");
const wasmMagic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

describe("committed llvm-project toolchain assets", () => {
  test("clang and lld wasm binaries start with the WebAssembly magic", () => {
    for (const name of ["clang.wasm", "lld.wasm"] as const) {
      const header = readFileSync(join(assets, name)).subarray(0, 4);
      expect(header, name).toEqual(wasmMagic);
    }
  });

  test("clang and lld js glue export the Emscripten createModule factory", () => {
    for (const name of ["clang.js", "lld.js"] as const) {
      const source = readFileSync(join(assets, name), "utf8");
      expect(source, name).toContain("async function createModule");
      expect(source, name).toContain("export default createModule");
    }
  });

  test("clang and lld wasm compile without experimental heap types", () => {
    for (const name of ["clang.wasm", "lld.wasm"] as const) {
      const bytes = readFileSync(join(assets, name));
      expect(() => new WebAssembly.Module(bytes), name).not.toThrow();
    }
  });

  test("sysroot archive is a gzip payload", () => {
    const header = readFileSync(join(assets, "sysroot.tgz")).subarray(0, 2);
    expect(header).toEqual(Buffer.from([0x1f, 0x8b]));
  });
});
