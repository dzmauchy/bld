import { describe, expect, test } from "@rstest/core";
import { ClangFrontend } from "../../src/clang.ts";
import type { EmscriptenModuleFactory, EmscriptenRuntime } from "../../src/emscripten.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { WasmLinker } from "../../src/linker.ts";
import { ObjectFile } from "../../src/object-file.ts";

function emscriptenApi(fs: MemoryFileSystem): EmscriptenFsApi {
  return {
    mkdir: (path) => fs.mkdirTree(path),
    mkdirTree: (path) => fs.mkdirTree(path),
    writeFile: (path, data) => fs.writeFile(path, data),
    readFile: (path) => fs.readFile(path),
    readdir: (path) => fs.list(path),
    unlink: (path) => fs.unlink(path),
    rmdir: (path) => fs.rmdir(path),
    chdir: (path) => fs.chdir(path),
    analyzePath: (path) => ({ exists: fs.exists(path) }),
    stat: (path) => ({ mode: fs.isDirectory(path) ? 0o040000 : 0o100000 }),
    isDir: (mode) => (mode & 0o170000) === 0o040000,
  };
}

function factory(fs: MemoryFileSystem, onMain: (args: string[]) => void): EmscriptenModuleFactory {
  return async (): Promise<EmscriptenRuntime> => ({
    FS: emscriptenApi(fs),
    callMain: (args) => {
      onMain(args);
      return 0;
    },
  });
}

describe("clang frontend and wasm linker", () => {
  test("clang writes headers and sources then emits one object per translation unit", async () => {
    const fs = new MemoryFileSystem();
    let compiled = "";
    const clang = new ClangFrontend(factory(fs, (args) => {
      compiled = args.at(-3) ?? "";
      fs.writeTree(args.at(-1) ?? "", new Uint8Array([9, 8, 7]));
    }), "clang.wasm");
    await clang.boot();
    const objects = await clang.compile(new Map([
      ["scale.h", "int scale(int);"],
      ["scale.cpp", "#include \"scale.h\"\nint scale(int value) { return value * 3; }"],
    ]));
    expect(compiled).toBe("/work/scale.cpp");
    expect(new TextDecoder().decode(fs.readFile("/work/scale.h"))).toContain("int scale");
    expect(objects).toHaveLength(1);
    expect(objects[0]?.path).toBe("/work/scale.o");
    expect(objects[0]?.bytes).toEqual(new Uint8Array([9, 8, 7]));
  });

  test("clang recycles its emscripten module after each compile", async () => {
    const fs = new MemoryFileSystem();
    let boots = 0;
    const clang = new ClangFrontend(async () => {
      boots += 1;
      return {
        FS: emscriptenApi(fs),
        callMain: (args) => {
          fs.writeTree(args.at(-1) ?? "", new Uint8Array([1]));
          return 0;
        },
      };
    }, "clang.wasm");
    await clang.boot();
    expect(boots).toBe(1);
    await clang.compile(new Map([["add.cpp", "extern \"C\" int add() { return 1; }"]]));
    expect(boots).toBe(2);
  });

  test("linker writes object files into its own filesystem before producing wasm", async () => {
    const fs = new MemoryFileSystem();
    const seen: string[] = [];
    const linker = new WasmLinker(factory(fs, (args) => {
      seen.push(...args);
      fs.writeTree(args.at(-1) ?? "", new Uint8Array([0, 97, 115, 109]));
    }), "lld.wasm");
    await linker.boot();
    const wasm = await linker.link([new ObjectFile("/work/scale.o", new Uint8Array([9, 8, 7]))]);
    expect(fs.exists("/work/scale.o")).toBe(true);
    expect(seen).toContain("/work/scale.o");
    expect(wasm).toEqual(new Uint8Array([0, 97, 115, 109]));
  });
});

describe("precompiled header lifecycle", () => {
  test("restores cached PCH bytes and headers into every fresh AST and compile filesystem", async () => {
    const runs: string[][] = [];
    let builds = 0;
    const clang = new ClangFrontend(async (options) => {
      const fs = new MemoryFileSystem();
      return {
        FS: emscriptenApi(fs),
        callMain(args) {
          runs.push(args);
          const include = args.indexOf("-include-pch");
          if (args.includes("c++-header")) {
            builds += 1;
            expect(fs.exists("/work/value.hpp")).toBe(true);
            fs.writeTree(args.at(-1)!, new Uint8Array([builds]));
          } else {
            expect(include).toBeGreaterThan(-1);
            expect(fs.readFile(args[include + 1]!)).toEqual(new Uint8Array([builds]));
            expect(fs.exists("/work/value.hpp")).toBe(true);
            if (args.includes("-c")) fs.writeTree(args.at(-1)!, new Uint8Array([42]));
            else options?.print?.('{"kind":"TranslationUnitDecl"}');
          }
          return 0;
        },
      };
    }, "clang.wasm");
    await clang.boot();
    const files = new Map([
      ["value.hpp", "#pragma once\nconstexpr int value = 1;"],
      ["main.cpp", "int answer() { return value; }"],
    ]);
    await clang.precompileHeaders(files);
    expect(builds).toBe(1);
    expect((await clang.dumpAst(files, "main.cpp")).ok).toBe(true);
    expect((await clang.emitAst(files, "main.cpp")).ok).toBe(true);
    files.set("other.cpp", "int other() { return value + 1; }");
    expect(await clang.compile(files)).toHaveLength(2);
    expect(builds).toBe(1);
    files.set("value.hpp", "#pragma once\nconstexpr int value = 2;");
    await clang.compile(files);
    expect(builds).toBe(2);
    expect(runs.filter((args) => args.includes("-include-pch"))).toHaveLength(6);
  });

  test("retries failed PCH generation and restores the cache after an aborted compilation", async () => {
    let pchAttempts = 0;
    let compileAttempts = 0;
    const clang = new ClangFrontend(async () => {
      const fs = new MemoryFileSystem();
      return {
        FS: emscriptenApi(fs),
        callMain(args) {
          if (args.includes("c++-header")) {
            if (++pchAttempts === 1) return 1;
            fs.writeTree(args.at(-1)!, new Uint8Array([7]));
          } else {
            expect(fs.readFile(args[args.indexOf("-include-pch") + 1]!)).toEqual(new Uint8Array([7]));
            if (++compileAttempts === 1) throw new Error("Aborted");
            fs.writeTree(args.at(-1)!, new Uint8Array([42]));
          }
          return 0;
        },
      };
    }, "clang.wasm");
    await clang.boot();
    const files = new Map([["value.hpp", "#pragma once"], ["main.cpp", "int answer;"]]);
    await expect(clang.precompileHeaders(files)).rejects.toThrow("exited with 1");
    expect((await clang.compile(files))[0]?.bytes).toEqual(new Uint8Array([42]));
    expect(pchAttempts).toBe(2);
    expect(compileAttempts).toBe(2);
  });
});
