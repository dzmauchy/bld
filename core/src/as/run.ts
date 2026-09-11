import { attachWorker } from "./workerHost.ts";
import type { RunRequest, WorkerResponse } from "./messages.ts";

/** Wasm `env` imports. UI/browser hosts merge their bindings into this object. */
export type EnvBindings = {
  abort?: (message: number, fileName: number, line: number, column: number) => void;
  seed?: () => number;
  [name: string]: WebAssembly.ImportValue | undefined;
};

export function defaultEnvBindings(): EnvBindings {
  return {
    abort(_message: number, _fileName: number, line: number, column: number) {
      throw new Error(`AssemblyScript abort at ${line}:${column}`);
    },
    seed() {
      return 1;
    },
  };
}

export function createWasmImports(env: EnvBindings): WebAssembly.Imports {
  const filtered: WebAssembly.ModuleImports = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) filtered[name] = value;
  }
  return { env: filtered };
}

function toBufferSource(wasm: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (wasm instanceof ArrayBuffer) return wasm;
  const copy = new Uint8Array(wasm.byteLength);
  copy.set(wasm);
  return copy.buffer;
}

export async function instantiateWasm(
  wasm: Uint8Array | ArrayBuffer,
  imports: WebAssembly.Imports = createWasmImports(defaultEnvBindings()),
): Promise<WebAssembly.Instance> {
  const result = await WebAssembly.instantiate(toBufferSource(wasm), imports);
  return result.instance;
}

/**
 * Worker entry used by the default run worker and by UI workers that inject
 * extra `env` bindings (for example `sendPinF32`).
 *
 * Functions cannot be posted into a worker, so the UI provides bindings by
 * calling this from its own worker module:
 *
 * ```ts
 * startRunWorker({
 *   ...defaultEnvBindings(),
 *   sendPinF32(blockId, pin, value) { postMessage({ type: "pin", blockId, pin, value }); },
 * });
 * ```
 */
export function startRunWorker(env: EnvBindings = defaultEnvBindings()): void {
  let instance: WebAssembly.Instance | null = null;
  const imports = createWasmImports(env);
  attachWorker(async (data): Promise<WorkerResponse> => {
    const message = data as RunRequest;
    if (message.type === "instantiate") {
      instance = await instantiateWasm(message.wasm, imports);
      return { id: message.id, type: "ok" };
    }
    if (message.type === "invoke") {
      if (!instance) throw new Error("wasm is not instantiated");
      const fn = instance.exports[message.name];
      if (typeof fn !== "function") {
        throw new Error(`missing wasm export ${message.name}`);
      }
      const result = (fn as (...args: number[]) => unknown)(...(message.args ?? []));
      return { id: message.id, type: "ok", result: typeof result === "number" ? result : 0 };
    }
    throw new Error(`unknown run worker message ${(message as { type?: string }).type}`);
  });
}
