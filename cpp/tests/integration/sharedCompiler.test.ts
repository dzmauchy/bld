import { packTar } from "modern-tar";
import { describe, expect, test } from "@rstest/core";
import { ClangFrontend } from "../../src/clang.ts";
import { CppWasmCompiler } from "../../src/compiler.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
import { WasmLinker } from "../../src/linker.ts";
import { SharedToolchainFileSystem } from "../../src/sharedFileSystem.ts";
import { DisposableToolFactory } from "../toolchainFixture.ts";

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
  test("keeps sysroot and PCH in place across disposable tools and links object paths without copies", async () => {
    const files = new RecordingFiles();
    let pchBuilds = 0;
    const clangFactory = new DisposableToolFactory(files, (_options, fs, args) => {
      expect(fs.exists("/sysroot/include/test.h")).toBe(true);
      if (args.includes("c++-header")) {
        pchBuilds++;
        fs.writeTree(args.at(-1)!, new Uint8Array([7]));
      } else {
        expect(args).toContain("-include-pch");
        expect(fs.readFile("/pch/headers.pch")).toEqual(new Uint8Array([7]));
        fs.writeTree(args.at(-1)!, new Uint8Array([42]));
      }
      return 0;
    });
    const linkerFactory = new DisposableToolFactory(files, (_options, fs, args) => {
      expect(fs.exists("/sysroot/lib/libc.a")).toBe(true);
      for (const path of ["/work/main.o", "/work/other.o"]) {
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
      { header: { name: "sysroot/lib/libc.a", size: 3 }, body: "lib" },
    ]);
    const gzip = await new Response(new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => { fetches++; return new Response(gzip); }) as typeof fetch;
    try {
      await Promise.all([compiler.initialize(), compiler.initialize()]);
      const sources = new Map([
        ["value.hpp", "#pragma once\nconstexpr int value = 42;"],
        ["main.cpp", "int mainValue() { return value; }"],
        ["other.cpp", "int otherValue() { return value; }"],
      ]);
      await compiler.precompileHeaders(sources);
      const pchStat = files.stat("/pch/headers.pch");
      expect(await compiler.compile(sources)).toEqual(new Uint8Array([0, 97, 115, 109]));
      sources.set("main.cpp", "int mainValue() { return value + 1; }");
      await compiler.compile(sources);
      expect(fetches).toBe(1);
      expect(pchBuilds).toBe(1);
      expect(files.writeCount("/sysroot/include/test.h")).toBe(1);
      expect(files.writeCount("/sysroot/lib/libc.a")).toBe(1);
      expect(files.writeCount("/pch/headers.pch")).toBe(1);
      expect(files.stat("/pch/headers.pch")).toEqual(pchStat);
      expect(files.copiedObjects).toBe(0);
      expect(clangFactory.boots).toBe(5);
      expect(linkerFactory.boots).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("invalidates changed headers, prunes removed files and recovers after an aborted compile", async () => {
    const files = new RecordingFiles();
    let pchBuilds = 0;
    let abortNext = false;
    const factory = new DisposableToolFactory(files, (options, fs, args) => {
      if (args.includes("c++-header")) {
        fs.writeTree(args.at(-1)!, new Uint8Array([++pchBuilds]));
      } else {
        if (abortNext) { abortNext = false; throw new Error("Aborted"); }
        if (args.includes("-include-pch")) expect(fs.readFile("/pch/headers.pch")[0]).toBe(pchBuilds);
        if (args.includes("-c")) fs.writeTree(args.at(-1)!, new Uint8Array([42]));
        else options?.print?.('{"kind":"TranslationUnitDecl"}');
      }
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", files);
    const sources = new Map([["nested/value.hpp", "#pragma once\nconstexpr int value = 1;"], ["main.cpp", "int answer = value;"]]);
    await clang.precompileHeaders(sources);
    const headerStat = files.stat("/work/nested/value.hpp");
    expect((await clang.dumpAst(sources, "main.cpp")).ok).toBe(true);
    expect(files.stat("/work/nested/value.hpp")).toEqual(headerStat);
    sources.set("nested/value.hpp", "#pragma once\nconstexpr int value = 2;");
    abortNext = true;
    await clang.compile(sources);
    expect(pchBuilds).toBe(2);
    sources.delete("nested/value.hpp");
    sources.set("main.cpp", "int answer = 3;");
    await clang.compile(sources);
    expect(files.exists("/work/nested/value.hpp")).toBe(false);
    expect(files.exists("/pch/headers.pch")).toBe(false);
    expect((await clang.dumpAst(sources, "main.cpp")).ok).toBe(true);
    expect(files.exists("/work/main.o")).toBe(false);
  });

  test("reports missing PROXYFS support instead of silently disabling shared storage", async () => {
    const files = new SharedToolchainFileSystem();
    const clang = new ClangFrontend(async () => ({ FS: {} as EmscriptenFsApi, PROXYFS: undefined, callMain: () => 0 }), "clang.wasm", files);
    await expect(clang.boot()).rejects.toThrow("must export FS.mount and PROXYFS");
  });
});
