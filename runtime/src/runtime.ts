import type { RunInstantiateRequest, RunInvokeRequest, WorkerOk, WorkerResponse } from "./messages.ts";

export type HostMessageHandler = (message: unknown) => void;

export abstract class Thread {
  abstract postMessage(data: unknown): void;
  abstract onMessage(handler: (data: unknown) => void): void;
  abstract onError(handler: (error: Error) => void): void;
  abstract terminate(): Promise<unknown>;
}

export type NodeWorkerLike = {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  terminate(): unknown;
};

export type EventTargetWorkerLike = {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
};

export class NodeWorkerThread extends Thread {
  constructor(private readonly worker: NodeWorkerLike) {
    super();
  }

  override postMessage(data: unknown): void { this.worker.postMessage(data); }
  override onMessage(handler: (data: unknown) => void): void { this.worker.on("message", handler); }
  override onError(handler: (error: Error) => void): void { this.worker.on("error", handler); }
  override terminate(): Promise<unknown> { return Promise.resolve(this.worker.terminate()); }
}

export class EventTargetWorkerThread extends Thread {
  constructor(private readonly worker: EventTargetWorkerLike) {
    super();
  }

  override postMessage(data: unknown): void { this.worker.postMessage(data); }
  override onMessage(handler: (data: unknown) => void): void {
    this.worker.addEventListener("message", (event) => handler(event.data));
  }
  override onError(handler: (error: Error) => void): void {
    this.worker.addEventListener("error", (event) => handler(new Error(event.message ?? "worker error")));
  }
  override terminate(): Promise<unknown> { return Promise.resolve(this.worker.terminate()); }
}

export const wrapNodeWorker = (worker: NodeWorkerLike): Thread => new NodeWorkerThread(worker);
export const wrapEventTargetWorker = (worker: EventTargetWorkerLike): Thread => new EventTargetWorkerThread(worker);

function isWorkerResponse(message: unknown): message is WorkerResponse {
  return (
    message !== null &&
    typeof message === "object" &&
    "id" in message &&
    "type" in message &&
    ((message as WorkerResponse).type === "ok" || (message as WorkerResponse).type === "error")
  );
}

class WorkerClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly thread: Thread,
    onHostMessage?: HostMessageHandler,
  ) {
    this.thread.onMessage((message) => {
      if (!isWorkerResponse(message)) {
        onHostMessage?.(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        onHostMessage?.(message);
        return;
      }
      this.pending.delete(message.id);
      pending.resolve(message);
    });
    this.thread.onError((error) => {
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
  }

  async request(
    payload: Omit<RunInstantiateRequest, "id"> | Omit<RunInvokeRequest, "id">,
  ): Promise<WorkerOk> {
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<WorkerResponse>();
    this.pending.set(id, { resolve, reject });
    this.thread.postMessage({ ...payload, id });
    const response = await promise;
    if (response.type === "error") {
      throw new Error(response.message);
    }
    return response;
  }

  terminate(): Promise<unknown> {
    return Promise.resolve(this.thread.terminate());
  }
}

export class WasmSession {
  constructor(private readonly client: WorkerClient) {}

  tick(): Promise<number> { return this.call("tick"); }
  tickThenObserve(): Promise<number> { return this.call("tickThenObserve"); }
  setNow(ms: number): Promise<number> { return this.call("setNow", ms); }
  setRandom(value: number): Promise<number> { return this.call("setRandom", value); }
  emitGpioIn(blockId: number, pinIndex: number, value: boolean): Promise<number> {
    return this.call("emitGpioIn", blockId, pinIndex, value ? 1 : 0);
  }
  close(): Promise<number> { return this.call("close"); }
  clearPins(): Promise<number> { return this.call("clearPins"); }
  lastPin(blockId: number, pin: number): Promise<number> { return this.call("lastPin", blockId, pin); }
  hasPin(blockId: number, pin: number): Promise<boolean> {
    return this.call("hasPin", blockId, pin).then((value) => value !== 0);
  }
  pinWriteCount(): Promise<number> { return this.call("pinWriteCount"); }
  activeIntervalCount(): Promise<number> { return this.call("activeIntervalCount"); }
  intervalPeriodAt(index: number): Promise<number> { return this.call("intervalPeriodAt", index); }
  activeGpioListenerCount(): Promise<number> { return this.call("activeGpioListenerCount"); }

  async call(name: string, ...args: number[]): Promise<number> {
    const response = await this.client.request({ type: "invoke", name, args });
    return typeof response.result === "number" ? response.result : 0;
  }
}

export type WasmRuntimeOptions = {
  runThread: Thread;
  onHostMessage?: HostMessageHandler;
};

export abstract class AbstractWasmRuntime {
  abstract instantiate(wasm: Uint8Array): Promise<WasmSession>;
  abstract close(): Promise<void>;
}

export class WasmRuntime extends AbstractWasmRuntime {
  private readonly run: WorkerClient;

  constructor(options: WasmRuntimeOptions) {
    super();
    this.run = new WorkerClient(options.runThread, options.onHostMessage);
  }

  override async instantiate(wasm: Uint8Array): Promise<WasmSession> {
    await this.run.request({ type: "instantiate", wasm });
    return new WasmSession(this.run);
  }

  override async close(): Promise<void> {
    await this.run.terminate();
  }
}
