import { describe, expect, test } from "vitest";
import { ClangFrontend } from "../../src/clang.ts";
import { CppWasmCompiler, WorkerCppWasmCompiler } from "../../src/compiler.ts";
import type { EmscriptenModuleFactory, EmscriptenRuntime } from "../../src/emscripten.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { WasmLinker } from "../../src/linker.ts";
import type { WorkerResponse } from "../../src/messages.ts";
import { Thread } from "../../src/thread.ts";

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

class ScriptedModuleFactory {
  readonly runs: string[][] = [];

  constructor(
    private readonly fs: MemoryFileSystem,
    private readonly writeOutput: (args: string[], fs: MemoryFileSystem) => void,
  ) {}

  readonly create: EmscriptenModuleFactory = async (): Promise<EmscriptenRuntime> => ({
    FS: emscriptenApi(this.fs),
    callMain: (args) => {
      this.runs.push(args);
      this.writeOutput(args, this.fs);
      return 0;
    },
  });
}

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
    const clangFs = new MemoryFileSystem();
    const lldFs = new MemoryFileSystem();
    const objectBytes = new Uint8Array([1, 2, 3, 4]);
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1]);
    const clang = new ScriptedModuleFactory(clangFs, (args, fs) => {
      fs.writeTree(args.at(-1) ?? "", objectBytes);
    });
    const lld = new ScriptedModuleFactory(lldFs, (args, fs) => {
      fs.writeTree(args.at(-1) ?? "", wasmBytes);
    });

    const frontend = new ClangFrontend(clang.create, "clang.wasm");
    const linker = new WasmLinker(lld.create, "lld.wasm");
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
    expect(clang.runs[0]?.at(-1)).toBe("/work/add.o");
    expect(lld.runs).toHaveLength(1);
    expect(lld.runs[0]).toContain("/work/add.o");
    expect(lldFs.exists("/work/add.o")).toBe(true);
  });

  test("emits JSON and text ASTs without stripping comments", async () => {
    const clangFs = new MemoryFileSystem();
    const lldFs = new MemoryFileSystem();
    const clang = new ScriptedModuleFactory(clangFs, () => {});
    const lld = new ScriptedModuleFactory(lldFs, () => {});

    const frontend = new ClangFrontend(clang.create, "clang.wasm");
    const linker = new WasmLinker(lld.create, "lld.wasm");
    await frontend.boot();
    await linker.boot();
    const compiler = new CppWasmCompiler(frontend, linker, "sysroot.tgz");

    const source = '/*{"blocks":{},"connections":{}}*/\nextern "C" void mount() {}';
    const json = await compiler.dumpAst(new Map([["demo.cpp", source]]), "demo.cpp");
    expect(json.ok).toBe(true);
    expect(clang.runs.at(-1)).toContain("-ast-dump=json");
    expect(clang.runs.at(-1)).toContain("-fparse-all-comments");
    expect(new TextDecoder().decode(clangFs.readFile("/work/demo.cpp"))).toContain('"blocks"');

    const text = await compiler.emitAst(new Map([["demo.cpp", source]]), "demo.cpp");
    expect(text.ok).toBe(true);
    expect(clang.runs.at(-1)).toContain("-ast-dump");
    expect(clang.runs.at(-1)).toContain("-fparse-all-comments");
    expect(new TextDecoder().decode(clangFs.readFile("/work/demo.cpp"))).toContain('"blocks"');
  });

  test("flushes the trailing stdout line into the AST dump", async () => {
    const fs = new MemoryFileSystem();
    const create: EmscriptenModuleFactory = async (options) => ({
      FS: {
        ...emscriptenApi(fs),
        streams: [
          undefined,
          { tty: { ops: { fsync: () => options?.print?.("}") } } },
        ],
      } as EmscriptenFsApi,
      callMain: () => 0,
    });
    const frontend = new ClangFrontend(create, "clang.wasm");
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

  test("emits a text AST through the compiler worker", async () => {
    const thread = new ScriptedThread((request) => {
      if (request.type === "init") return { id: request.id as number, type: "ok" };
      expect(request.type).toBe("emit-ast");
      expect(request.mainFile).toBe("add.cpp");
      return { id: request.id as number, type: "ok", result: 0, astText: "TranslationUnitDecl", stdout: "TranslationUnitDecl", stderr: "" };
    });

    const compiler = new WorkerCppWasmCompiler(thread);
    const dump = await compiler.emitAst(new Map([["add.cpp", "int add(int a, int b) { return a + b; }"]]), "add.cpp");

    expect(dump.ok).toBe(true);
    expect(dump.astText).toBe("TranslationUnitDecl");
  });
});
