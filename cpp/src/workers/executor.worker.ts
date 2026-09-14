import { DefaultWasmBindings } from "../bindings.ts";
import type { ExecutorRequest, WorkerResponse } from "../messages.ts";
import { attachWorker } from "./host.ts";

export class WasmExecutorSession {
  private instance: WebAssembly.Instance | null = null;

  async instantiate(wasm: Uint8Array): Promise<string[]> {
    const bytes = new Uint8Array(wasm.byteLength);
    bytes.set(wasm);
    const module = await WebAssembly.compile(bytes);
    let instance: WebAssembly.Instance | undefined;
    const bindings = new DefaultWasmBindings(() => {
      const memory = instance?.exports["memory"];
      if (memory instanceof WebAssembly.Memory) return memory;
      throw new Error("wasm module has no exported memory");
    });
    instance = await WebAssembly.instantiate(module, bindings.fill(module));
    this.instance = instance;
    const ctors = instance.exports["__wasm_call_ctors"];
    if (typeof ctors === "function") (ctors as () => void)();
    return Object.keys(instance.exports);
  }

  invoke(name: string, args: number[]): number {
    if (!this.instance) throw new Error("wasm is not instantiated");
    const fn = this.instance.exports[name];
    if (typeof fn !== "function") throw new Error(`missing wasm export ${name}`);
    const result = (fn as (...values: number[]) => unknown)(...args);
    return typeof result === "number" ? result : 0;
  }
}

const session = new WasmExecutorSession();

attachWorker(async (data): Promise<WorkerResponse> => {
  const message = data as ExecutorRequest;
  if (message.type === "instantiate") {
    const names = await session.instantiate(message.wasm);
    return { id: message.id, type: "ok", exports: names };
  }
  if (message.type === "invoke") {
    const result = session.invoke(message.name, message.args ?? []);
    return { id: message.id, type: "ok", result };
  }
  throw new Error(`unknown executor worker message ${(message as { type?: string }).type}`);
});
