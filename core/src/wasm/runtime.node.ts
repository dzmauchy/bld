import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { WasmRuntime, wrapNodeWorker, type Thread } from "./runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function nodeThread(specifier: string): Thread {
  return wrapNodeWorker(
    new Worker(join(here, specifier), {
      execArgv: ["--experimental-strip-types", "--no-warnings"],
    }),
  );
}

export function createNodeWasmRuntime(): WasmRuntime {
  return new WasmRuntime({
    runThread: nodeThread("run.worker.ts"),
  });
}
