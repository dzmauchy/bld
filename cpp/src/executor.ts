import { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";

export class ExecutedWasm {
  constructor(private readonly client: RpcClient) {}

  async invoke(name: string, ...args: number[]): Promise<number> {
    const response = await this.client.request({ type: "invoke", name, args });
    return typeof response.result === "number" ? response.result : 0;
  }
}

export class WasmExecutor {
  private readonly client: RpcClient;

  constructor(thread: Thread) {
    this.client = new RpcClient(thread);
  }

  async warmup(): Promise<void> {}

  async instantiate(wasm: Uint8Array): Promise<ExecutedWasm> {
    await this.client.request({ type: "instantiate", wasm });
    return new ExecutedWasm(this.client);
  }

  async close(): Promise<void> {
    await this.client.terminate();
  }
}
