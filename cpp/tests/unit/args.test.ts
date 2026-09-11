import { describe, expect, test } from "@rstest/core";
import { ClangArgumentBuilder, LldArgumentBuilder } from "../../src/args.ts";

describe("toolchain argument builders", () => {
  test("clang dumps a JSON AST without compiling an object", () => {
    const args = new ClangArgumentBuilder().syntaxOnlyAstDump("/work/add.cpp");
    expect(args).toContain("-fsyntax-only");
    expect(args).toContain("-Xclang");
    expect(args).toContain("-ast-dump=json");
    expect(args).toContain("-fparse-all-comments");
    expect(args.at(-1)).toBe("/work/add.cpp");
    expect(args).not.toContain("-c");
  });

  test("clang emits a text AST with comments", () => {
    const args = new ClangArgumentBuilder().emitAst("/work/add.cpp");
    expect(args).toContain("-fsyntax-only");
    expect(args).toContain("-Xclang");
    expect(args).toContain("-ast-dump");
    expect(args).toContain("-fparse-all-comments");
    expect(args).not.toContain("-ast-dump=json");
    expect(args.at(-1)).toBe("/work/add.cpp");
    expect(args).not.toContain("-c");
  });

  test("clang compiles one source to an object with the emscripten sysroot", () => {
    const args = new ClangArgumentBuilder().build("/work/add.cpp", "/work/add.o");
    expect(args).toContain("--target=wasm32-unknown-emscripten");
    expect(args).toContain("--sysroot=/sysroot");
    expect(args).toContain("-resource-dir");
    expect(args).toContain("/sysroot/lib/clang/23");
    expect(args).toContain("-std=c++20");
    expect(args).toContain("-fno-threadsafe-statics");
    expect(args.at(-3)).toBe("/work/add.cpp");
    expect(args.at(-1)).toBe("/work/add.o");
  });

  test("lld links objects against the staged static libraries", () => {
    const args = new LldArgumentBuilder().build(["/work/add.o"], "/work/a.wasm");
    expect(args.slice(0, 2)).toEqual(["-flavor", "wasm"]);
    expect(args).toContain("--no-entry");
    expect(args).toContain("--export-all");
    expect(args).toContain("/work/add.o");
    expect(args).toContain("/sysroot/lib/wasm32-emscripten/crt1_reactor.o");
    expect(args).toContain("-lc++-noexcept");
    expect(args).toContain("-lstandalonewasm");
    expect(args.at(-2)).toBe("-o");
    expect(args.at(-1)).toBe("/work/a.wasm");
  });
});
