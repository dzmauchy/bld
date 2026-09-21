import { describe, expect, test } from "vitest";
import { nativeLibraryFiles, nativeHeaderNames } from "../../src/index.ts";

describe("native C++ library assets", () => {
  test("exports the base headers used by diagram codegen", () => {
    const files = nativeLibraryFiles();
    expect(Object.keys(files)).toEqual([...nativeHeaderNames]);
    expect(files["bld.hpp"]).toContain("class Block");
    expect(files["base.hpp"]).toContain("namespace push::f32");
    expect(files["base.hpp"]).toContain("class ScopeF32");
    expect(files["base.hpp"]).toContain("class GpioInF32");
    expect(files["wasm_host.hpp"]).toContain("build_diagram");
    expect(files["wasm_host.cpp"]).toContain("emitGpioIn");
    expect(files["wasm_host.cpp"]).toContain("lastPin");
  });
});
