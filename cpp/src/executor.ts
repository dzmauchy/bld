import { WorkerPool } from "./pool.ts";
import type { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";

export class ExecutedWasm {
  constructor(private readonly client: RpcClient) {}

  async invoke(name: string, ...args: number[]): Promise<number> {
    const response = await this.client.request({ type: "invoke", name, args });
    return typeof response.result === "number" ? response.result : 0;
  }
}

export type WasmExecutorOptions = {
  pool?: WorkerPool;
  run: Thread | (() => Thread);
};

export class WasmExecutor {
  private readonly pool: WorkerPool;
  private readonly factory: () => Thread;
  private ready: Promise<RpcClient> | undefined;

  constructor(options: WasmExecutorOptions) {
    this.pool = options.pool ?? new WorkerPool();
    this.factory = typeof options.run === "function" ? options.run : () => options.run as Thread;
  }

  get workerCreateCount(): number {
    return this.pool.createCount;
  }

  async warmup(): Promise<void> {
    await this.ensureWorker();
  }

  async instantiate(wasm: Uint8Array): Promise<ExecutedWasm> {
    const client = await this.ensureWorker();
    await client.request({ type: "instantiate", wasm });
    return new ExecutedWasm(client);
  }

  async close(): Promise<void> {
    this.ready = undefined;
    await this.pool.close();
  }

  private ensureWorker(): Promise<RpcClient> {
    this.ready ??= Promise.resolve(this.pool.acquire("executor", this.factory));
    return this.ready;
  }
}
