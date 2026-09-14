import { describe, expect, test } from "vitest";
import { WorkerPool } from "../../src/pool.ts";
import { RpcClient } from "../../src/rpc.ts";
import { Thread } from "../../src/thread.ts";
import type { WorkerResponse } from "../../src/messages.ts";

class MockThread extends Thread {
  readonly posted: unknown[] = [];
  private messageHandler: ((data: unknown) => void) | undefined;
  terminated = false;

  override postMessage(data: unknown): void {
    this.posted.push(data);
    const id = (data as { id: number }).id;
    const response: WorkerResponse = { id, type: "ok", resourceDir: "/sysroot/lib/clang/23" };
    queueMicrotask(() => this.messageHandler?.(response));
  }

  override onMessage(handler: (data: unknown) => void): void {
    this.messageHandler = handler;
  }

  override onError(): void {}

  override terminate(): Promise<unknown> {
    this.terminated = true;
    return Promise.resolve();
  }
}

describe("WorkerPool", () => {
  test("reuses the same worker for a named tool", async () => {
    const pool = new WorkerPool();
    const threads: MockThread[] = [];
    const factory = () => {
      const thread = new MockThread();
      threads.push(thread);
      return thread;
    };

    const first = pool.acquire("clang", factory);
    const second = pool.acquire("clang", factory);
    expect(first).toBe(second);
    expect(pool.createCount).toBe(1);
    expect(threads).toHaveLength(1);

    await first.request({ type: "init" });
    await second.request({ type: "run" });
    expect(threads[0]?.posted).toHaveLength(2);
  });

  test("creates distinct workers for clang, lld, and the executor", () => {
    const pool = new WorkerPool();
    pool.acquire("clang", () => new MockThread());
    pool.acquire("lld", () => new MockThread());
    pool.acquire("executor", () => new MockThread());
    expect(pool.createCount).toBe(3);
    expect(pool.acquire("clang", () => new MockThread())).toBeInstanceOf(RpcClient);
    expect(pool.createCount).toBe(3);
  });
});
