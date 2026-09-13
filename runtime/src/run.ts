import { attachWorker, createHostPinNotifier } from "./workerHost.ts";
import type { RunRequest, WorkerResponse } from "./messages.ts";

export { createHostPinNotifier };

/** Host `env` imports used by the browser wasm profile. */
export type EnvBindings = {
  sendPinF32?: (blockId: number, pin: number, value: number) => void;
  cos?: (value: number) => number;
  sin?: (value: number) => number;
  [name: string]: WebAssembly.ImportValue | undefined;
};

export function defaultEnvBindings(): EnvBindings {
  return {
    sendPinF32() {},
    cos: Math.cos,
    sin: Math.sin,
  };
}

export function hostPinEnvBindings(): EnvBindings {
  return {
    ...defaultEnvBindings(),
    sendPinF32: createHostPinNotifier(),
  };
}

/** JS String Builtins polyfill used when the engine does not provide `wasm:js-string`. */
export function jsStringBuiltins(): WebAssembly.ModuleImports {
  return {
    fromCharCode(code: number) {
      return String.fromCharCode(code);
    },
    concat(a: unknown, b: unknown) {
      return `${String(a)}${String(b)}`;
    },
    length(value: unknown) {
      return String(value).length;
    },
    equals(a: unknown, b: unknown) {
      return String(a) === String(b) ? 1 : 0;
    },
    compare(a: unknown, b: unknown) {
      const left = String(a);
      const right = String(b);
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
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
  env: EnvBindings = defaultEnvBindings(),
): Promise<WebAssembly.Instance> {
  const bytes = toBufferSource(wasm);
  const envImports = createWasmImports(env);
  try {
    const compile = WebAssembly.compile as (
      bytes: BufferSource,
      options?: { builtins?: string[] },
    ) => Promise<WebAssembly.Module>;
    const module = await compile(bytes, { builtins: ["js-string"] });
    return await WebAssembly.instantiate(module, envImports);
  } catch {
    const result = await WebAssembly.instantiate(bytes, {
      ...envImports,
      "wasm:js-string": jsStringBuiltins(),
    });
    return result.instance;
  }
}

/**
 * Worker entry used by the default run worker and by UI workers that inject
 * extra `env` bindings (for example `sendPinF32`).
 */
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
