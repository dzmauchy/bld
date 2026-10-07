import { describe, expect, test } from "@rstest/core";
import { ClangArgumentBuilder, LldArgumentBuilder } from "../../src/args.ts";

describe("toolchain argument builders", () => {
  test("clang emits JSON dumps and objects using the launcher defaults", () => {
    expect(new ClangArgumentBuilder().build(["/work/add.cpp", "/work/nested/mul.cpp"])).toEqual([
      "-dump", "--output-dir", "/work/build", "/work/add.cpp", "/work/nested/mul.cpp",
    ]);
  });

  test("lld links objects against the staged static libraries", () => {
    const args = new LldArgumentBuilder().build(["/work/add.o"], "/work/a.wasm");
    expect(args).not.toContain("-flavor");
    expect(args).toContain("--no-entry");
    expect(args).toContain("--export-dynamic");
    expect(args).toContain("--export=__wasm_call_ctors");
    expect(args).not.toContain("--allow-undefined");
    expect(args).toContain("/work/add.o");
    expect(args).toContain("--export-memory");
    expect(args).toContain("/sysroot/lib");
    expect(args).toContain("-lbrowser");
    expect(args).toContain("-lc++");
    expect(args).toContain("-lc++abi");
    expect(args).toContain("-lc");
    expect(args).toContain("-lm");
    expect(args).toContain("-lclang_rt.builtins-wasm32");
    expect(args.at(-2)).toBe("-o");
    expect(args.at(-1)).toBe("/work/a.wasm");
  });
});
