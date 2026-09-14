import { describe, expect, test } from "vitest";
import { CppWasmProducer } from "../../src/producer.ts";
import { ToolchainAssets } from "../../src/assets.ts";
import { WorkerPool } from "../../src/pool.ts";
import { Thread } from "../../src/thread.ts";
import type { WorkerResponse } from "../../src/messages.ts";

class ScriptedThread extends Thread {
  private handler: ((data: unknown) => void) | undefined;

  constructor(private readonly onRequest: (data: Record<string, unknown>) => WorkerResponse) {
    super();
  }

  override postMessage(data: unknown): void {
    const request = data as Record<string, unknown>;
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

describe("CppWasmProducer orchestration", () => {
  test("sends sources to clang then object files to lld without creating extra workers", async () => {
    const pool = new WorkerPool();
    let clangRuns = 0;
    let lldRuns = 0;
    const objectBytes = new Uint8Array([0, 97, 115, 109]);
    const wasmBytes = new Uint8Array([0, 97, 115, 109, 1]);

    const producer = new CppWasmProducer({
      pool,
      assets: ToolchainAssets.fromBase("/toolchain"),
      clang: () =>
        new ScriptedThread((request) => {
          if (request.type === "init") return { id: request.id as number, type: "ok", resourceDir: "/sysroot/lib/clang/23" };
          clangRuns += 1;
          return { id: request.id as number, type: "ok", files: { "/work/add.o": objectBytes } };
        }),
      lld: () =>
        new ScriptedThread((request) => {
          if (request.type === "init") return { id: request.id as number, type: "ok" };
          lldRuns += 1;
          const files = request.files as Array<{ path: string }>;
          expect(files.some((file) => file.path === "/work/add.o")).toBe(true);
          return { id: request.id as number, type: "ok", files: { "/work/a.wasm": wasmBytes } };
        }),
    });

    const first = await producer.compile(new Map([["add.cpp", "int add(int a, int b) { return a + b; }"]]));
    const second = await producer.compile(new Map([["add.cpp", "extern \"C\" int add(int a, int b) { return a + b; }"]]));
    expect(first).toEqual(wasmBytes);
    expect(second).toEqual(wasmBytes);
    expect(clangRuns).toBe(2);
    expect(lldRuns).toBe(2);
    expect(pool.createCount).toBe(2);
  });
});
