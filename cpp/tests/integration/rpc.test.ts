import { expect, test } from "vitest";
import { RpcClient } from "cpp/rpc.ts";
import { EventTargetWorkerThread } from "cpp/thread.ts";
import { WasmRuntime } from "core/runtime/runtime.ts";

class ControlledWorker extends EventTarget {
  private readonly requests: { id: number; type: string }[] = [];
  private closed = false;

  postMessage(message: { id: number; type: string }): void {
    if (this.closed) throw new Error("transport is closed");
    this.requests.push(message);
  }

  request(index: number): Readonly<{ id: number; type: string }> { return this.requests[index]!; }
  asThread(): EventTargetWorkerThread {
    return new EventTargetWorkerThread({
      postMessage: (message) => this.postMessage(message as { id: number; type: string }),
      addEventListener: (type, listener) => this.addEventListener(type, listener as EventListener),
      terminate: () => this.terminate(),
    });
  }
  terminate(): void { this.closed = true; }
  deliver(message: unknown): void { this.dispatchEvent(new MessageEvent("message", { data: message })); }
  fail(message: string): void {
    this.dispatchEvent(Object.assign(new Event("error"), { message }));
  }
}

test("matches overlapping replies while keeping progress and pin events separate", async () => {
  const worker = new ControlledWorker();
  const hostMessages: unknown[] = [];
  const client = new RpcClient(worker.asThread(), message => hostMessages.push(message));
  const progress: unknown[] = [];
  let completed = false;
  const first = client.request({ type: "compile" }, message => progress.push(message))
    .then(response => { completed = true; return response; });
  const second = client.request({ type: "invoke", name: "answer", args: [] });
  const phase = { id: worker.request(0).id, type: "progress", progress: { phase: "compilation", status: "active" } };
  const pin = { type: "pin", blockId: 4, pin: 0, value: 1.25 };
  worker.deliver(phase);
  worker.deliver(pin);
  worker.deliver({ id: worker.request(1).id, type: "ok", result: 42 });
  expect((await second).result).toBe(42);
  expect(completed).toBe(false);
  expect(progress).toEqual([phase]);
  expect(hostMessages).toEqual([pin]);
  worker.deliver({ id: worker.request(0).id, type: "ok" });
  await first;
  await client.terminate();
});

test("a failed request preserves diagnostics and leaves subsequent requests usable", async () => {
  const worker = new ControlledWorker();
  const client = new RpcClient(worker.asThread());
  const failure = expect(client.request({ type: "compile" })).rejects.toThrow("invalid C++\nsource.cpp:1: error");
  worker.deliver({ id: worker.request(0).id, type: "error", message: "invalid C++", stderr: "source.cpp:1: error" });
  await failure;
  const next = client.request({ type: "invoke", name: "answer", args: [] });
  worker.deliver({ id: worker.request(1).id, type: "ok", result: 42 });
  expect((await next).result).toBe(42);
  await client.terminate();
});

test("a worker failure rejects every outstanding call and subsequent requests", async () => {
  const worker = new ControlledWorker();
  const client = new RpcClient(worker.asThread());
  const first = expect(client.request({ type: "init" })).rejects.toThrow("worker crashed");
  const second = expect(client.request({ type: "compile" })).rejects.toThrow("worker crashed");
  worker.fail("worker crashed");
  await Promise.all([first, second]);
  await expect(client.request({ type: "init" })).rejects.toThrow("worker crashed");
  await client.terminate();
});

test("a synchronous postMessage failure rejects its request", async () => {
  const worker = new ControlledWorker();
  const client = new RpcClient(worker.asThread());
  worker.terminate();
  await expect(client.request({ type: "init" })).rejects.toThrow("transport is closed");
  await client.terminate();
});

test("the diagram runtime uses the shared transport for signals and shutdown", async () => {
  const worker = new ControlledWorker();
  const messages: unknown[] = [];
  const runtime = new WasmRuntime({ runThread: worker.asThread(), onHostMessage: message => messages.push(message) });
  const instantiating = runtime.instantiate(new Uint8Array([0, 97, 115, 109]));
  worker.deliver({ id: worker.request(0).id, type: "ok" });
  const session = await instantiating;
  const ticking = expect(session.tick()).rejects.toThrow("worker is closed");
  const pin = { type: "pin", blockId: 0, pin: 1, value: 2.5 };
  worker.deliver(pin);
  expect(messages).toEqual([pin]);
  await runtime.close();
  await ticking;
  await expect(session.tick()).rejects.toThrow("worker is closed");
});
