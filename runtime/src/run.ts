import { attachWorker, createHostPinNotifier } from "./workerHost.ts";
import type { RunRequest, WorkerResponse } from "./messages.ts";
import { DefaultWasmBindings } from "cpp";

export { createHostPinNotifier };

export type EnvBindings = {
  sendPinF32?: (blockId: number, pin: number, value: number) => void;
};

export function defaultEnvBindings(): EnvBindings {
  return {
    sendPinF32() {},
  };
}

export function hostPinEnvBindings(): EnvBindings {
  return {
    sendPinF32: createHostPinNotifier(),
  };
}

function toBytes(wasm: Uint8Array | ArrayBuffer): Uint8Array {
  if (wasm instanceof ArrayBuffer) return new Uint8Array(wasm);
  const copy = new Uint8Array(wasm.byteLength);
  copy.set(wasm);
  return copy;
}

function callExport(instance: WebAssembly.Instance, name: string, args: number[] = []): number {
  const fn = instance.exports[name];
  if (typeof fn !== "function") return 0;
  const result = (fn as (...values: number[]) => unknown)(...args);
  return typeof result === "number" ? result : 0;
}

export async function instantiateWasm(
  wasm: Uint8Array | ArrayBuffer,
  env: EnvBindings = defaultEnvBindings(),
): Promise<WebAssembly.Instance> {
  const bytes = toBytes(wasm);
  const module = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
  let instance: WebAssembly.Instance | undefined;
  const bindings = new DefaultWasmBindings(
    () => {
      const memory = instance?.exports["memory"];
      if (memory instanceof WebAssembly.Memory) return memory;
      throw new Error("wasm module has no exported memory");
    },
    env.sendPinF32 ? { sendPinF32: env.sendPinF32 } : {},
  );
  instance = await WebAssembly.instantiate(module, bindings.fill(module));
  const initialize = instance.exports["_initialize"];
  if (typeof initialize === "function") (initialize as () => void)();
  else {
    const ctors = instance.exports["__wasm_call_ctors"];
    if (typeof ctors === "function") (ctors as () => void)();
  }
  callExport(instance, "start");
  return instance;
}

export function startRunWorker(env: EnvBindings = defaultEnvBindings()): void {
  let instance: WebAssembly.Instance | null = null;
  attachWorker(async (data): Promise<WorkerResponse> => {
    const message = data as RunRequest;
    if (message.type === "instantiate") {
      instance = await instantiateWasm(message.wasm, env);
      return { id: message.id, type: "ok" };
    }
    if (message.type === "invoke") {
      if (!instance) throw new Error("wasm is not instantiated");
      const result = callExport(instance, message.name, message.args ?? []);
      return { id: message.id, type: "ok", result };
    }
    throw new Error(`unknown run worker message ${(message as { type?: string }).type}`);
  });
}
