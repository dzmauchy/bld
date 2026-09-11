import { Worker } from "node:worker_threads";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type CompileRequest = {
  type: "compile";
  id: number;
  source: string;
  assemblyDir: string;
};

type RunInstantiate = { type: "instantiate"; id: number; wasm: Uint8Array };
type RunInvoke = { type: "invoke"; id: number; name: string; args: number[] };

type WorkerResponse =
  | { id: number; type: "ok"; wasm?: Uint8Array; result?: number }
  | { id: number; type: "error"; message: string };

class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>();

  constructor(private readonly worker: Worker) {
    worker.on("message", (message: WorkerResponse) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve(message);
    });
    worker.on("error", (error) => {
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
  }

  async request(payload: Omit<CompileRequest | RunInstantiate | RunInvoke, "id">): Promise<WorkerResponse> {
    const id = this.nextId++;
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, id });
    });
    if (response.type === "error") {
      throw new Error(response.message);
    }
    return response;
  }

  terminate(): Promise<number> {
    return this.worker.terminate();
  }
}

const GENERATED_PRELUDE = `import { DiscardF32, TestExecutionContext, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./harness";
import { GpioIn } from "./gpio";
import { ConstF32, CosF32, CosGenF32, ProductF32, PulseGenF32, RandGenF32, ScopeF32, SinF32, SinGenF32 } from "./push";

const ec = new TestExecutionContext();
`;

const GENERATED_EXPORTS = `
export function tick(): void { ec.tick(); }
export function setNow(ms: u32): void { ec.setNow(u64(ms)); }
export function setRandom(value: f32): void { ec.setRandom(value); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
export function close(): void { ec.close(); }
export function clearPins(): void { ec.clearPins(); }
export function lastPin(blockId: u32, pin: u8): f32 { return ec.lastPin(blockId, pin); }
export function hasPin(blockId: u32, pin: u8): i32 { return ec.hasPin(blockId, pin) ? 1 : 0; }
export function pinWriteCount(): i32 { return ec.pinWriteCount(); }
export function activeIntervalCount(): i32 { return ec.activeIntervalCount(); }
export function intervalPeriodAt(index: i32): u32 { return ec.intervalPeriodAt(index); }
export function activeGpioListenerCount(): i32 { return ec.activeGpioListenerCount(); }
export function tickThenObserve(): void { ec.tickThenObserve(); }
`;

export function wrapGenerated(body: string): string {
  return `${GENERATED_PRELUDE}\n${body}\n${GENERATED_EXPORTS}\n`;
}

export class AsSession {
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

export class AsRuntime {
  private compile: WorkerClient;
  private run: WorkerClient;
  private wasmCache = new Map<string, Uint8Array>();

  constructor(private readonly assemblyDir: string) {
    this.compile = new WorkerClient(new Worker(join(here, "compile.worker.js")));
    this.run = new WorkerClient(new Worker(join(here, "run.worker.js")));
  }

  async createSession(body: string): Promise<AsSession> {
    const source = wrapGenerated(body);
    let wasm = this.wasmCache.get(source);
    if (!wasm) {
      const compiled = await this.compile.request({
        type: "compile",
        source,
        assemblyDir: this.assemblyDir,
      });
      if (!(compiled.wasm instanceof Uint8Array)) {
        throw new Error("compile worker did not return wasm");
      }
      wasm = compiled.wasm;
      this.wasmCache.set(source, wasm);
    }
    await this.run.request({ type: "instantiate", wasm });
    return new AsSession(this.run);
  }

  async close(): Promise<void> {
    await Promise.all([this.compile.terminate(), this.run.terminate()]);
  }
}
