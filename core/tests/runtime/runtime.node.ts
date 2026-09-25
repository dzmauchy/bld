/** Node `worker_threads` harness for executing diagram wasm in tests. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  Thread,
  WasmRuntime,
  type HostMessageHandler,
} from "../../src/runtime/runtime.ts";

export class NodeWorkerThread extends Thread {
  constructor(private readonly worker: Worker) {
    super();
  }

  override postMessage(data: unknown): void {
    this.worker.postMessage(data);
  }

  override onMessage(handler: (data: unknown) => void): void {
    this.worker.on("message", handler);
  }

  override onError(handler: (error: Error) => void): void {
    this.worker.on("error", handler);
  }

  override terminate(): Promise<unknown> {
    return Promise.resolve(this.worker.terminate());
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function nodeRunThread(): Thread {
  return new NodeWorkerThread(
    new Worker(join(here, "run.worker.ts"), {
      execArgv: ["--experimental-strip-types", "--no-warnings"],
    }),
  );
}

export type NodeWasmRuntimeOptions = {
  onHostMessage?: HostMessageHandler;
};

export function createNodeWasmRuntime(options: NodeWasmRuntimeOptions = {}): WasmRuntime {
  return new WasmRuntime({
    runThread: nodeRunThread(),
    ...(options.onHostMessage ? { onHostMessage: options.onHostMessage } : {}),
  });
}
