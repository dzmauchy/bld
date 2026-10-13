import { RpcClient } from "cpp/rpc.ts";
import type { Thread } from "cpp/thread.ts";

export { Thread, EventTargetWorkerThread, wrapEventTargetWorker } from "cpp/thread.ts";
export type { EventTargetWorkerLike } from "cpp/thread.ts";

export type HostMessageHandler = (message: unknown) => void;

export class WasmSession {
  constructor(private readonly client: RpcClient) {}

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
  private readonly run: RpcClient;

  constructor(options: WasmRuntimeOptions) {
    super();
    this.run = new RpcClient(options.runThread, options.onHostMessage);
  }

  override async instantiate(wasm: Uint8Array): Promise<WasmSession> {
    await this.run.request({ type: "instantiate", wasm });
    return new WasmSession(this.run);
  }

  override async close(): Promise<void> {
    await this.run.terminate();
  }
}
