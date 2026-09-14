import { ToolchainAssets } from "../assets.ts";
import { WasmExecutor } from "../executor.ts";
import { WorkerPool } from "../pool.ts";
import { CppWasmProducer } from "../producer.ts";
import { wrapEventTargetWorker } from "../thread.ts";

export type BrowserCppRuntime = {
  producer: CppWasmProducer;
  executor: WasmExecutor;
  pool: WorkerPool;
};

export type CppPageApi = {
  warmup(): Promise<void>;
  compile(files: Record<string, string>): Promise<number>;
  invoke(name: string, args: number[]): Promise<number>;
  compileAndInvoke(files: Record<string, string>, name: string, args: number[]): Promise<number>;
  workerCreateCount(): number;
};

export function createToolWorker(): Worker {
  return new Worker(new URL("../workers/tool.worker.ts", import.meta.url), { type: "module" });
}

export function createExecutorWorker(): Worker {
  return new Worker(new URL("../workers/executor.worker.ts", import.meta.url), { type: "module" });
}

export function createBrowserCppRuntime(assets = ToolchainAssets.fromBase("/toolchain")): BrowserCppRuntime {
  const pool = new WorkerPool();
  const producer = new CppWasmProducer({
    pool,
    assets,
    clang: () => wrapEventTargetWorker(createToolWorker()),
    lld: () => wrapEventTargetWorker(createToolWorker()),
  });
  const executor = new WasmExecutor({
    pool,
    run: () => wrapEventTargetWorker(createExecutorWorker()),
  });
  return { producer, executor, pool };
}
