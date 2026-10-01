import { describe, expect, test } from "@rstest/core";
import { ClangArgumentBuilder, LldArgumentBuilder } from "../../src/args.ts";
import { ClangFrontend } from "../../src/clang.ts";
import { CppWasmCompiler } from "../../src/compiler.ts";
import type { EmscriptenModuleFactory, EmscriptenRuntime } from "../../src/emscripten.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { WasmLinker } from "../../src/linker.ts";
import { ObjectFile } from "../../src/object-file.ts";
import { ProxyWorkMount } from "../../src/proxyWorkMount.ts";

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

  test("links object files through PROXYFS without copying them between clang and lld", async () => {
    const modules = new ProxyModuleFactory();
    const workMount = new ProxyWorkMount();
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1]);
    const clang = new ClangFrontend(modules.create, "clang.wasm", new ClangArgumentBuilder(), workMount);
    const linker = new WasmLinker(modules.create, "lld.wasm", new LldArgumentBuilder(), workMount);
    await clang.boot();
    await linker.boot();
    const compiler = new CppWasmCompiler(clang, linker, "sysroot.tgz");

    const wasm = await compiler.compile(new Map([
      ["a.cpp", "int a() { return 1; }"],
      ["b.cpp", "int b() { return 2; }"],
    ]));
    const second = await compiler.compile(new Map([
      ["c.cpp", "int c() { return 3; }"],
    ]));

    expect(wasm).toEqual(wasmBytes);
    expect(second).toEqual(wasmBytes);
    expect(modules.objectReads).toEqual([]);
    expect(modules.objectWrites).toEqual([]);
    expect(modules.mounts).toBe(3);
    const withFirstObjects = modules.filesystems.filter((fs) => fs.exists("/work/a.o"));
    const withSecondObject = modules.filesystems.filter((fs) => fs.exists("/work/c.o"));
    expect(withFirstObjects).toHaveLength(1);
    expect(withFirstObjects[0]?.exists("/work/b.o")).toBe(true);
    expect(withSecondObject).toHaveLength(1);
    expect(withSecondObject[0]).not.toBe(withFirstObjects[0]);
    expect(withSecondObject[0]?.exists("/work/a.o")).toBe(false);
    expect(modules.runs.filter((args) => args.includes("/work/a.o") && args.at(-1)?.endsWith(".wasm"))).toHaveLength(1);
  });
});

class ProxyModuleFactory {
  readonly filesystems: MemoryFileSystem[] = [];
  readonly runs: string[][] = [];
  readonly objectReads: string[] = [];
  readonly objectWrites: string[] = [];
  mounts = 0;
  private readonly backing = new WeakMap<EmscriptenFsApi, MemoryFileSystem>();

  readonly create: EmscriptenModuleFactory = async (): Promise<EmscriptenRuntime> => {
    const local = new MemoryFileSystem();
    this.filesystems.push(local);
    let host: MemoryFileSystem | undefined;
    const resolve = (path: string): MemoryFileSystem =>
      host && (path === "/work" || path.startsWith("/work/")) ? host : local;
    const fs: EmscriptenFsApi = {
      mkdir: (path) => resolve(path).mkdirTree(path),
      mkdirTree: (path) => resolve(path).mkdirTree(path),
      writeFile: (path, data) => {
        if (path.endsWith(".o")) this.objectWrites.push(path);
        resolve(path).writeFile(path, data);
      },
      readFile: (path) => {
        if (path.endsWith(".o")) this.objectReads.push(path);
        return resolve(path).readFile(path);
      },
      readdir: (path) => resolve(path).list(path),
      unlink: (path) => resolve(path).unlink(path),
      rmdir: (path) => resolve(path).rmdir(path),
      chdir: (path) => resolve(path).chdir(path),
      analyzePath: (path) => ({ exists: resolve(path).exists(path) }),
      stat: (path) => ({ mode: resolve(path).isDirectory(path) ? 0o040000 : 0o100000 }),
      isDir: (mode) => (mode & 0o170000) === 0o040000,
      mount: (_type, opts, mountpoint) => {
        if (mountpoint !== "/work" || opts.root !== "/work") {
          throw new Error(`unexpected PROXYFS mount ${opts.root} at ${mountpoint}`);
        }
        const backing = this.backing.get(opts.fs);
        if (!backing) throw new Error("PROXYFS host is not a compiler filesystem");
        host = backing;
        this.mounts += 1;
      },
    };
    this.backing.set(fs, local);
    return {
      FS: fs,
      PROXYFS: {},
      callMain: (args) => {
        this.runs.push(args);
        const output = args.at(-1) ?? "";
        if (output.endsWith(".wasm")) {
          for (const path of args) {
            if (path.startsWith("/work/") && path.endsWith(".o") && !resolve(path).exists(path)) {
              throw new Error(`missing ${path}`);
            }
          }
        }
        const bytes = output.endsWith(".wasm") ? new Uint8Array([0, 97, 115, 109, 1]) : new Uint8Array([1, 2, 3, 4]);
        resolve(output).writeTree(output, bytes);
        return 0;
      },
    };
  };
}

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
