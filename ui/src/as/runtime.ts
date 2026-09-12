import { ASRuntime, wrapEventTargetWorker, type ASRuntimeOptions } from "core/as";
import { assemblyAssets } from "../assemblyAssets.ts";

export type BrowserASRuntimeOptions = {
  onHostMessage?: ASRuntimeOptions["onHostMessage"];
};

/** Create an ASRuntime that compiles and runs wasm in browser workers. */
export function createBrowserASRuntime(options: BrowserASRuntimeOptions = {}): ASRuntime {
  const compileWorker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
  const runWorker = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
  return new ASRuntime({
    compileThread: wrapEventTargetWorker(compileWorker),
    runThread: wrapEventTargetWorker(runWorker),
    files: assemblyAssets,
    ...(options.onHostMessage ? { onHostMessage: options.onHostMessage } : {}),
  });
}
