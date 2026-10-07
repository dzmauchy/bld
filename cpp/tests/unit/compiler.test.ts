import { describe, expect, test } from "@rstest/core";
import { ClangFrontend } from "../../src/clang.ts";
import { CppWasmCompiler, WorkerCppWasmCompiler } from "../../src/compiler.ts";
import type { EmscriptenModuleFactory } from "../../src/emscripten.ts";
import { SharedToolchainFileSystem } from "../../src/sharedFileSystem.ts";
import { DisposableToolFactory, writeClangOutputs } from "../toolchainFixture.ts";
import { WasmLinker } from "../../src/linker.ts";
import type { WorkerResponse } from "../../src/messages.ts";
import { Thread } from "../../src/thread.ts";

class ScriptedThread extends Thread {
  private handler: ((data: unknown) => void) | undefined;
  readonly posted: Record<string, unknown>[] = [];

  constructor(private readonly onRequest: (data: Record<string, unknown>) => WorkerResponse) {
    super();
  }

  override postMessage(data: unknown): void {
    const request = data as Record<string, unknown>;
    this.posted.push(request);
    const response = this.onRequest(request);
    queueMicrotask(() => this.handler?.(response));
  }

  override onMessage(handler: (data: unknown) => void): void {
    this.handler = handler;
  }

  override onError(): void {}

  override terminate(): Promise<unknown> {
    return Promise.resolve();
  }
}

describe("CppWasmCompiler", () => {
  test("compiles sources with clang then links objects with lld", async () => {
    const files = new SharedToolchainFileSystem();
    const objectBytes = new Uint8Array([1, 2, 3, 4]);
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1]);
    const clang = new DisposableToolFactory(files, (_options, fs, args) => {
      writeClangOutputs(fs, args, objectBytes);
      return 0;
    });
    const lld = new DisposableToolFactory(files, (_options, fs, args) => {
      fs.writeTree(args.at(-1) ?? "", wasmBytes);
      return 0;
    });

    const frontend = new ClangFrontend(clang.create, "clang.wasm", files);
    const linker = new WasmLinker(lld.create, "lld.wasm", files);
    await frontend.boot();
    await linker.boot();
    const compiler = new CppWasmCompiler(frontend, linker, "sysroot.tgz");

    const wasm = await compiler.compile(new Map([
      ["add.h", "int add(int, int);"],
      ["add.cpp", "int add(int a, int b) { return a + b; }"],
    ]));

    expect(wasm).toEqual(wasmBytes);
    expect(clang.runs).toHaveLength(1);
    expect(clang.runs[0]).toContain("/work/add.cpp");
    expect(clang.runs[0]).toContain("-o");
    expect(lld.runs).toHaveLength(1);
    expect(lld.runs[0]).toContain("/work/build/add.o");
    expect(files.exists("/work/build/add.o")).toBe(true);
  });

  test("reads JSON AST files without stripping comments", async () => {
    const files = new SharedToolchainFileSystem();
    const clang = new DisposableToolFactory(files, (_options, fs, args) => { writeClangOutputs(fs, args); return 0; });
    const lld = new DisposableToolFactory(files, () => 0);

    const frontend = new ClangFrontend(clang.create, "clang.wasm", files);
    const linker = new WasmLinker(lld.create, "lld.wasm", files);
    await frontend.boot();
    await linker.boot();
    const compiler = new CppWasmCompiler(frontend, linker, "sysroot.tgz");

    const source = '/*{"blocks":{},"connections":{}}*/\nextern "C" void mount() {}';
    const json = await compiler.dumpAst(new Map([["demo.cpp", source]]), "demo.cpp");
    expect(json.ok).toBe(true);
    expect(clang.runs.at(-1)).toContain("-o");
    expect(json.ast).toMatchObject({ kind: "TranslationUnitDecl" });
    expect(new TextDecoder().decode(files.readFile("/work/demo.cpp"))).toContain('"blocks"');
  });

  test("flushes the trailing stdout line into captured compiler output", async () => {
    const files = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(files, () => 0);
    const create: EmscriptenModuleFactory = async (options) => {
      const runtime = await factory.create(options);
      Object.assign(runtime.FS, {
        streams: [undefined, { tty: { ops: { fsync: () => options?.print?.("}") } } }],
      });
      return runtime;
    };
    const frontend = new ClangFrontend(create, "clang.wasm", files);
    await frontend.boot();
    const dump = await frontend.dumpAst(new Map([["demo.cpp", "int x;"]]), "demo.cpp");
    expect(dump.stdout).toBe("}");
  });
});

describe("WorkerCppWasmCompiler", () => {
  test("sends each compilation to a single clang/lld worker", async () => {
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1]);
    const thread = new ScriptedThread((request) => {
      if (request.type === "init") return { id: request.id as number, type: "ok" };
      expect(request.type).toBe("compile");
      const files = request.files as Record<string, string>;
      expect(files["add.cpp"]).toContain("return a + b");
      return { id: request.id as number, type: "ok", files: { "/work/a.wasm": wasmBytes } };
    });

    const compiler = new WorkerCppWasmCompiler(thread);
    const first = await compiler.compile(new Map([["add.cpp", "int add(int a, int b) { return a + b; }"]]));
    const second = await compiler.compile(new Map([["add.cpp", "extern \"C\" int add(int a, int b) { return a + b; }"]]));

    expect(first).toEqual(wasmBytes);
    expect(second).toEqual(wasmBytes);
    expect(thread.posted.filter((message) => message.type === "init")).toHaveLength(1);
    expect(thread.posted.filter((message) => message.type === "compile")).toHaveLength(2);
    expect(thread.posted[0]).toMatchObject({ type: "init" });
  });

  test("dumps a JSON AST through the compiler worker", async () => {
    const ast = { kind: "TranslationUnitDecl" };
    const thread = new ScriptedThread((request) => {
      if (request.type === "init") return { id: request.id as number, type: "ok" };
      expect(request.type).toBe("dump-ast");
      expect(request.mainFile).toBe("add.cpp");
      return { id: request.id as number, type: "ok", result: 0, ast, stdout: "{}", stderr: "" };
    });

    const compiler = new WorkerCppWasmCompiler(thread);
    const dump = await compiler.dumpAst(new Map([["add.cpp", "int add(int a, int b) { return a + b; }"]]), "add.cpp");

    expect(dump.ok).toBe(true);
    expect(dump.ast).toEqual(ast);
  });
});
