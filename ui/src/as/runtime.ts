import { AsRuntime, wrapEventTargetWorker, type AsRuntimeOptions } from "core/as";
import { assemblyAssets } from "../assemblyAssets.ts";

export type BrowserAsRuntimeOptions = {
  onHostMessage?: AsRuntimeOptions["onHostMessage"];
};

/** Create an AsRuntime that compiles and runs wasm in browser workers. */
export function createBrowserAsRuntime(options: BrowserAsRuntimeOptions = {}): AsRuntime {
  const compileWorker = new Worker(new URL("./compile.worker.ts", import.meta.url), { type: "module" });
  const runWorker = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
  return new AsRuntime({
    compileThread: wrapEventTargetWorker(compileWorker),
    runThread: wrapEventTargetWorker(runWorker),
    files: assemblyAssets,
    ...(options.onHostMessage ? { onHostMessage: options.onHostMessage } : {}),
  });
}
