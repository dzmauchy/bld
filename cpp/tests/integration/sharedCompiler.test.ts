import { packTar } from "modern-tar";
import { describe, expect, test } from "@rstest/core";
import { ClangFrontend } from "../../src/clang.ts";
import { CppWasmCompiler } from "../../src/compiler.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
import { WasmLinker } from "../../src/linker.ts";
import { SharedToolchainFileSystem } from "../../src/sharedFileSystem.ts";
import { DisposableToolFactory, writeClangOutputs } from "../toolchainFixture.ts";

class RecordingFiles extends SharedToolchainFileSystem {
  private readonly writes = new Map<string, number>();
  private objectCopies = 0;

  override writeFile(path: string, data: string | Uint8Array): void {
    this.writes.set(path, this.writeCount(path) + 1);
    super.writeFile(path, data);
  }

  override readFile(path: string): Uint8Array {
    if (path.endsWith(".o")) this.objectCopies++;
    return super.readFile(path);
  }

  writeCount(path: string): number { return this.writes.get(path) ?? 0; }
  get copiedObjects(): number { return this.objectCopies; }
}

describe("shared clang/lld storage", () => {
  test("keeps sysroot in place across disposable tools and links object paths without copies", async () => {
    const files = new RecordingFiles();
    const clangFactory = new DisposableToolFactory(files, (_options, fs, args) => {
      expect(fs.exists("/sysroot/include/test.h")).toBe(true);
      expect(args).not.toContain("-resource-dir");
      expect(args).not.toContain("-include-pch");
      writeClangOutputs(fs, args);
      return 0;
    });
    const linkerFactory = new DisposableToolFactory(files, (_options, fs, args) => {
      const searchPaths = args.flatMap((arg, index) => arg === "-L" ? [args[index + 1]!] : []);
      for (const library of args.filter((arg) => arg.startsWith("-l"))) {
        const name = `lib${library.slice(2)}.a`;
        expect(searchPaths.some((path) => fs.exists(`${path}/${name}`)), `linker must find ${name}`).toBe(true);
      }
      expect(fs.exists("/sysroot/lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a")).toBe(true);
      for (const path of ["/work/build/main.o", "/work/build/other.o"]) {
        const stream = fs.open(path, 0);
        const bytes = new Uint8Array(1);
        expect(fs.read(stream, bytes, 0, 1, 0)).toBe(1);
        expect(bytes[0]).toBe(42);
        fs.close(stream);
      }
      fs.writeTree(args.at(-1)!, new Uint8Array([0, 97, 115, 109]));
      return 0;
    });
    const compiler = new CppWasmCompiler(
      new ClangFrontend(clangFactory.create, "clang.wasm", files),
      new WasmLinker(linkerFactory.create, "lld.wasm", files),
      "https://example.test/sysroot.tgz",
    );
    const tar = await packTar([
      { header: { name: "sysroot/include/test.h", size: 5 }, body: "hello" },
      { header: { name: "sysroot/lib/clang/23/include/stddef.h", size: 5 }, body: "hello" },
      ...[
        "sysroot/lib/libbrowser.a",
        "sysroot/lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a",
      ].map((name) => ({ header: { name, size: 3 }, body: "lib" })),
    ]);
    const gzip = await new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => { fetches++; return new Response(gzip); }) as typeof fetch;
    try {
      await Promise.all([compiler.initialize(), compiler.initialize()]);
      const sources = new Map([
        ["value.hpp", "#pragma once\nconstexpr int value = 42;"],
        ["main.cpp", '#include "value.hpp"\nint mainValue() { return value; }'],
        ["other.cpp", '#include "value.hpp"\nint otherValue() { return value; }'],
      ]);
      expect(await compiler.compile(sources)).toEqual(new Uint8Array([0, 97, 115, 109]));
      sources.set("main.cpp", '#include "value.hpp"\nint mainValue() { return value + 1; }');
      await compiler.compile(sources);
      expect(fetches).toBe(1);
      expect(files.writeCount("/sysroot/include/test.h")).toBe(1);
      expect(files.writeCount("/sysroot/lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a")).toBe(1);
      expect(files.copiedObjects).toBe(0);
      expect(clangFactory.boots).toBe(2);
      expect(linkerFactory.boots).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses changed headers, prunes removed files and recovers after an aborted compile", async () => {
    const files = new RecordingFiles();
    let abortNext = false;
    const factory = new DisposableToolFactory(files, (_options, fs, args) => {
      if (abortNext) { abortNext = false; throw new Error("Aborted"); }
      writeClangOutputs(fs, args);
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", files);
    const sources = new Map([["nested/value.hpp", "#pragma once\nconstexpr int value = 1;"], ["main.cpp", '#include "nested/value.hpp"\nint answer = value;']]);
    await clang.dumpAst(sources, "main.cpp");
    const headerStat = files.stat("/work/nested/value.hpp");
    expect((await clang.dumpAst(sources, "main.cpp")).ok).toBe(true);
    expect(files.stat("/work/nested/value.hpp")).toEqual(headerStat);
    sources.set("nested/value.hpp", "#pragma once\nconstexpr int value = 2;");
    abortNext = true;
    await clang.compile(sources);
    sources.delete("nested/value.hpp");
    sources.set("main.cpp", "int answer = 3;");
    await clang.compile(sources);
    expect(files.exists("/work/nested/value.hpp")).toBe(false);
    expect(files.exists("/pch/headers.pch")).toBe(false);
    expect((await clang.dumpAst(sources, "main.cpp")).ok).toBe(true);
    expect(files.exists("/work/build/main.o")).toBe(true);
  });

  test("reports missing PROXYFS support instead of silently disabling shared storage", async () => {
    const files = new SharedToolchainFileSystem();
    const clang = new ClangFrontend(async () => ({ FS: {} as EmscriptenFsApi, PROXYFS: undefined, callMain: () => 0 }), "clang.wasm", files);
    await expect(clang.boot()).rejects.toThrow("must export FS.mount and PROXYFS");
  });
});
