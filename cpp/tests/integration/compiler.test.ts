import { describe, expect, test } from "vitest";
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
