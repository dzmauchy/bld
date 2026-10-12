import { describe, expect, test } from "vitest";
import { ClangFrontend } from "cpp/clang.ts";
import { SharedToolchainFileSystem } from "cpp/sharedFileSystem.ts";
import { WasmLinker } from "cpp/linker.ts";
import { CppWasmCompiler, WorkerCppWasmCompiler } from "cpp/compiler.ts";
import type { WorkerResponse } from "cpp/messages.ts";
import { Thread } from "cpp/thread.ts";
import { WorkerMessageDispatcher, type WorkerMessageHandler } from "cpp/workers/host.ts";

class InProcessWorker extends Thread {
  private readonly dispatcher: WorkerMessageDispatcher;
  private handler: ((data: unknown) => void) | undefined;

  constructor(handler: WorkerMessageHandler) {
    super();
    this.dispatcher = new WorkerMessageDispatcher(handler, (response) => this.handler?.(response));
  }

  override postMessage(data: unknown): void {
    void this.dispatcher.dispatch(data);
  }

  override onMessage(handler: (data: unknown) => void): void {
    this.handler = handler;
  }

  override onError(): void {}

  override async terminate(): Promise<void> {
    this.handler = undefined;
  }
}

describe("reusable compiler worker", () => {
  test("AST and compile jobs await the pending startup promise and reuse it afterwards", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const requests: string[] = [];
    const wasm = new Uint8Array([0, 97, 115, 109]);
    const worker = new InProcessWorker(async (data): Promise<WorkerResponse> => {
      const { id, type } = data as { id: number; type: string };
      requests.push(type);
      if (type === "init") {
        started.resolve();
        await gate.promise;
      }
      return { id, type: "ok", result: 0, ast: {}, files: { "/work/a.wasm": wasm } };
    });
    const compiler = new WorkerCppWasmCompiler(worker);
    try {
      const startup = compiler.warmup();
      expect(compiler.warmup()).toBe(startup);
      await started.promise;
      const analysis = compiler.dumpAst(new Map(), "main.cpp");
      const compiled = compiler.compile(new Map());
      await Promise.resolve();
      expect(requests).toEqual(["init"]);
      gate.resolve();
      await Promise.all([startup, analysis]);
      expect(await compiled).toEqual(wasm);
      expect(compiler.warmup()).toBe(startup);
      await compiler.compile(new Map());
      expect(requests).toEqual(["init", "dump-ast", "compile", "compile"]);
    } finally {
      gate.resolve();
      await compiler.close();
    }
  });

  test("queues overlapping AST and compile jobs and continues after a failed job", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const requests: string[] = [];
    const wasm = new Uint8Array([0, 97, 115, 109]);
    const worker = new InProcessWorker(async (data): Promise<WorkerResponse> => {
      const { id, type } = data as { id: number; type: string };
      requests.push(type);
      if (type === "dump-ast") {
        started.resolve();
        await gate.promise;
        throw new Error("invalid source");
      }
      return { id, type: "ok", files: { "/work/a.wasm": wasm } };
    });
    const compiler = new WorkerCppWasmCompiler(worker);
    const dump = compiler.dumpAst(new Map(), "bad.cpp").catch((error: Error) => error.message);
    const compiled = compiler.compile(new Map([["next.cpp", "int next;"]]));
    await started.promise;
    expect(requests).toEqual(["init", "dump-ast"]);
    gate.resolve();
    expect(await dump).toBe("invalid source");
    expect(await compiled).toEqual(wasm);
    expect(requests).toEqual(["init", "dump-ast", "compile"]);
    await compiler.close();
  });

  test("retries initialization on the same worker after a failed warmup", async () => {
    let attempts = 0;
    const worker = new InProcessWorker(async (data) => {
      const { id } = data as { id: number };
      if (++attempts === 1) throw new Error("download failed");
      return { id, type: "ok" };
    });
    const compiler = new WorkerCppWasmCompiler(worker);
    await expect(compiler.warmup()).rejects.toThrow("download failed");
    await Promise.all([compiler.warmup(), compiler.warmup()]);
    expect(attempts).toBe(2);
    await compiler.close();
  });

  test("closing rejects pending requests and further uses of the worker", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const worker = new InProcessWorker(async (data) => {
      const { id, type } = data as { id: number; type: string };
      if (type === "compile") {
        started.resolve();
        await gate.promise;
      }
      return { id, type: "ok" };
    });
    const compiler = new WorkerCppWasmCompiler(worker);
    const compiling = compiler.compile(new Map()).catch((error: Error) => error.message);
    await started.promise;
    await compiler.close();
    expect(await compiling).toBe("worker is closed");
    await expect(compiler.warmup()).rejects.toThrow("worker is closed");
    gate.resolve();
  });
});


test("failed initialization waits for both tools before allowing a retry", async () => {
  const gate = Promise.withResolvers<void>();
  let boots = 0;
  let settled = false;
  const files = new SharedToolchainFileSystem();
  const clang = new ClangFrontend(async () => {
    boots += 1;
    await gate.promise;
    throw new Error("clang unavailable");
  }, "clang.wasm", files);
  const linker = new WasmLinker(async () => {
    throw new Error("lld unavailable");
  }, "lld.wasm", files);
  const compiler = new CppWasmCompiler(clang, linker, "sysroot.tgz");
  const initializing = compiler.initialize().catch((error: Error) => {
    settled = true;
    return error.message;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  gate.resolve();
  expect(await initializing).toBe("clang unavailable");
  await expect(compiler.initialize()).rejects.toThrow("clang unavailable");
  expect(boots).toBe(2);
});
