import { describe, expect, test } from "vitest";
import { ClangArgumentBuilder, LldArgumentBuilder } from "../../src/args.ts";
import { BrowserEmscriptenToolchain, McuUnknownToolchain } from "../../src/target.ts";

describe("toolchain argument builders", () => {
  test("clang dumps a JSON AST without compiling an object", () => {
    const args = new ClangArgumentBuilder().syntaxOnlyAstDump("/work/add.cpp");
    expect(args).toContain("-fsyntax-only");
    expect(args).toContain("-Xclang");
    expect(args).toContain("-ast-dump=json");
    expect(args).toContain("-fparse-all-comments");
    expect(args).toContain("--target=wasm32-unknown-emscripten");
    expect(args).toContain("-std=c++23");
    expect(args.at(-1)).toBe("/work/add.cpp");
    expect(args).not.toContain("-c");
  });

  test("clang emits a text AST with comments", () => {
    const args = new ClangArgumentBuilder().emitAst("/work/add.cpp");
    expect(args).toContain("-fsyntax-only");
    expect(args).toContain("-Xclang");
    expect(args).toContain("-ast-dump");
    expect(args).toContain("-fparse-all-comments");
    expect(args).toContain("--target=wasm32-unknown-emscripten");
    expect(args).toContain("-std=c++23");
    expect(args).not.toContain("-ast-dump=json");
    expect(args.at(-1)).toBe("/work/add.cpp");
    expect(args).not.toContain("-c");
  });

  test("clang compiles one source to an object for the browser Emscripten target", () => {
    const args = new ClangArgumentBuilder().build("/work/add.cpp", "/work/add.o");
    expect(args).toContain("--target=wasm32-unknown-emscripten");
    expect(args).toContain("--sysroot=/sysroot");
    expect(args).toContain("-resource-dir");
    expect(args).toContain("/sysroot/lib/clang/23");
    expect(args).toContain("-std=c++23");
    expect(args).toContain("-fno-threadsafe-statics");
    expect(args.at(-3)).toBe("/work/add.cpp");
    expect(args.at(-1)).toBe("/work/add.o");
  });

  test("lld links browser objects as Emscripten standalone with an 8 MiB stack", () => {
    const toolchain = new BrowserEmscriptenToolchain();
    const args = new LldArgumentBuilder(toolchain).build(["/work/add.o"], "/work/a.wasm");
    expect(args.slice(0, 2)).toEqual(["-flavor", "wasm"]);
    expect(args).toContain("--no-entry");
    expect(args).toContain("--export-all");
    expect(args).toContain("--unresolved-symbols=import-functions");
    expect(args).not.toContain("--allow-undefined");
    expect(args).toContain("--stack-first");
    expect(args).toContain(`stack-size=${toolchain.stackBytes}`);
    expect(toolchain.stackBytes).toBe(8 * 1024 * 1024);
    expect(args).toContain("/work/add.o");
    expect(args).toContain("/sysroot/lib/wasm32-emscripten/crt1_reactor.o");
    expect(args).toContain("-lc++-noexcept");
    expect(args).toContain("-lstandalonewasm");
    expect(args.at(-2)).toBe("-o");
    expect(args.at(-1)).toBe("/work/a.wasm");
  });

  test("MCU toolchain keeps the freestanding triple and does not link", () => {
    const toolchain = new McuUnknownToolchain();
    const args = toolchain.compileObject("/work/add.cpp", "/work/add.o", {
      resourceDir: "/sysroot/lib/clang/23",
      std: "c++23",
      optimize: "2",
    });
    expect(toolchain.profile).toBe("mcu");
    expect(toolchain.triple).toBe("wasm32-unknown-unknown");
    expect(args).toContain("--target=wasm32-unknown-unknown");
    expect(() => toolchain.link(["/work/add.o"], "/work/a.wasm")).toThrow(/MCU wasm profile is not implemented/);
    expect(new BrowserEmscriptenToolchain().triple).toBe("wasm32-unknown-emscripten");
  });
});
