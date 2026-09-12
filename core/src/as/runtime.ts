import type {
  CompileCompileRequest,
  CompileFiles,
  CompileInitRequest,
  CompileOptions,
  RunInstantiateRequest,
  RunInvokeRequest,
  WorkerOk,
  WorkerResponse,
} from "./messages.ts";

export type { CompileFiles, CompileOptions } from "./messages.ts";

export type HostMessageHandler = (message: unknown) => void;

export interface Thread {
  postMessage(data: unknown): void;
  onMessage(handler: (data: unknown) => void): void;
  onError(handler: (error: Error) => void): void;
  terminate(): void | Promise<unknown>;
}

type NodeWorkerLike = {
  postMessage(value: unknown): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  terminate(): unknown;
};

type EventTargetWorkerLike = {
  postMessage(value: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
};

export function wrapNodeWorker(worker: NodeWorkerLike): Thread {
  return {
    postMessage(data) {
      worker.postMessage(data);
    },
    onMessage(handler) {
      worker.on("message", handler);
    },
    onError(handler) {
      worker.on("error", handler);
    },
    terminate() {
      void worker.terminate();
    },
  };
}

export function wrapEventTargetWorker(worker: EventTargetWorkerLike): Thread {
  return {
    postMessage(data) {
      worker.postMessage(data);
    },
    onMessage(handler) {
      worker.addEventListener("message", (event) => {
        handler(event.data);
      });
    },
    onError(handler) {
      worker.addEventListener("error", (event) => {
        handler(new Error(event.message ?? "worker error"));
      });
    },
    terminate() {
      worker.terminate();
    },
  };
}

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
  private pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

  constructor(
    private readonly thread: Thread,
    onHostMessage?: HostMessageHandler,
  ) {
    thread.onMessage((message) => {
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
    thread.onError((error) => {
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
  }

  async request(
    payload:
      | Omit<CompileInitRequest, "id">
      | Omit<CompileCompileRequest, "id">
      | Omit<RunInstantiateRequest, "id">
      | Omit<RunInvokeRequest, "id">,
  ): Promise<WorkerOk> {
    const id = this.nextId++;
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.thread.postMessage({ ...payload, id });
    });
    if (response.type === "error") {
      throw new Error(response.message);
    }
    return response;
  }

  terminate(): void | Promise<unknown> {
    return this.thread.terminate();
  }
}

export class ASSession {
  constructor(private readonly client: WorkerClient) {}

  tick(): Promise<number> {
    return this.call("tick");
  }

  tickThenObserve(): Promise<number> {
    return this.call("tickThenObserve");
  }

  setNow(ms: number): Promise<number> {
    return this.call("setNow", ms);
  }

  setRandom(value: number): Promise<number> {
    return this.call("setRandom", value);
  }

  emitGpioIn(blockId: number, pinIndex: number, value: boolean): Promise<number> {
    return this.call("emitGpioIn", blockId, pinIndex, value ? 1 : 0);
  }

  close(): Promise<number> {
    return this.call("close");
  }

  clearPins(): Promise<number> {
    return this.call("clearPins");
  }

  lastPin(blockId: number, pin: number): Promise<number> {
    return this.call("lastPin", blockId, pin);
  }

  hasPin(blockId: number, pin: number): Promise<boolean> {
    return this.call("hasPin", blockId, pin).then((value) => value !== 0);
  }

  pinWriteCount(): Promise<number> {
    return this.call("pinWriteCount");
  }

  activeIntervalCount(): Promise<number> {
    return this.call("activeIntervalCount");
  }

  intervalPeriodAt(index: number): Promise<number> {
    return this.call("intervalPeriodAt", index);
  }

  activeGpioListenerCount(): Promise<number> {
    return this.call("activeGpioListenerCount");
  }

  async call(name: string, ...args: number[]): Promise<number> {
    const response = await this.client.request({ type: "invoke", name, args });
    return typeof response.result === "number" ? response.result : 0;
  }
}

export type ASRuntimeOptions = {
  compileThread: Thread;
  runThread: Thread;
  files: CompileFiles;
  compileOptions?: CompileOptions;
  onHostMessage?: HostMessageHandler;
};

export class ASRuntime {
  private compile: WorkerClient;
  private run: WorkerClient;
  private files: CompileFiles;
  private compileOptions: CompileOptions;
  private wasmCache = new Map<string, Uint8Array>();
  private initialized = false;

  constructor(options: ASRuntimeOptions) {
    this.compile = new WorkerClient(options.compileThread);
    this.run = new WorkerClient(options.runThread, options.onHostMessage);
    this.files = options.files;
    this.compileOptions = options.compileOptions ?? {};
  }

  async compileSource(
    source: string,
    files?: CompileFiles,
    options?: CompileOptions,
  ): Promise<Uint8Array> {
    await this.ensureInitialized();
    const effectiveOptions = { ...this.compileOptions, ...options };
    const cacheKey = files || options
      ? `${source}__${JSON.stringify({ files, options: effectiveOptions })}`
      : source;
    let wasm = this.wasmCache.get(cacheKey);
    if (!wasm) {
      const compiled = await this.compile.request({
        type: "compile",
        source,
        ...(files ? { files } : {}),
        options: effectiveOptions,
      });
      const compiledWasm = compiled.wasm;
      if (!(compiledWasm instanceof Uint8Array)) {
        throw new Error("compile worker did not return wasm");
      }
      wasm = compiledWasm;
      this.wasmCache.set(cacheKey, wasm);
    }
    return wasm;
  }

  async instantiate(wasm: Uint8Array): Promise<ASSession> {
    await this.run.request({ type: "instantiate", wasm });
    return new ASSession(this.run);
  }

  async createSession(
    source: string,
    files?: CompileFiles,
    options?: CompileOptions,
  ): Promise<ASSession> {
    const wasm = await this.compileSource(source, files, options);
    return this.instantiate(wasm);
  }

  async close(): Promise<void> {
    await Promise.all([this.compile.terminate(), this.run.terminate()]);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.compile.request({ type: "init", files: this.files });
    this.initialized = true;
  }
}
