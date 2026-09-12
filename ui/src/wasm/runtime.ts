import { WasmRuntime, wrapEventTargetWorker, type WasmRuntimeOptions } from "runtime/runtime.ts";

export type BrowserWasmRuntimeOptions = {
  onHostMessage?: WasmRuntimeOptions["onHostMessage"];
};

/** Create a WasmRuntime that runs wasm in a browser worker. */
export function createBrowserWasmRuntime(options: BrowserWasmRuntimeOptions = {}): WasmRuntime {
  const runWorker = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
  return new WasmRuntime({
    runThread: wrapEventTargetWorker(runWorker),
    ...(options.onHostMessage ? { onHostMessage: options.onHostMessage } : {}),
  });
}
