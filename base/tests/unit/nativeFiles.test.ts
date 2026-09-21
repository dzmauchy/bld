import { describe, expect, test } from "vitest";
import { nativeLibraryFiles, nativeHeaderNames } from "../../src/index.ts";

describe("native C++ library assets", () => {
  test("exports the base headers used by diagram codegen", () => {
    const files = nativeLibraryFiles();
    expect(Object.keys(files)).toEqual([...nativeHeaderNames]);
    expect(files["bld.hpp"]).toContain("class Block");
    expect(files["base.hpp"]).toContain("namespace push");
    expect(files["base.hpp"]).toContain("namespace f32");
    expect(files["base.hpp"]).toContain("class ScopeF32");
    expect(files["base.hpp"]).toContain("class GpioInF32");
    expect(files["wasm_host.hpp"]).toContain("void mount()");
    expect(files["wasm_host.hpp"]).toContain("emitGpioIn");
    expect(files["wasm_host.hpp"]).toContain("lastPin");
    expect(Object.keys(files).some((name) => name.endsWith(".cpp"))).toBe(false);
  });
});
