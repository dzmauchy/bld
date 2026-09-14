import { ToolchainAssets } from "../assets.ts";
import { WorkerCppWasmCompiler } from "../compiler.ts";
import { WasmExecutor } from "../executor.ts";
import { wrapEventTargetWorker } from "../thread.ts";

export type CppPageApi = {
  warmup(): Promise<void>;
  compile(files: Record<string, string>): Promise<number>;
  invoke(name: string, args: number[]): Promise<number>;
  compileAndInvoke(files: Record<string, string>, name: string, args: number[]): Promise<number>;
  workerCreateCount(): number;
};

export class BrowserCppRuntime {
  readonly compiler: WorkerCppWasmCompiler;
  readonly executor: WasmExecutor;
  readonly workerCreateCount: number;

  constructor(assets = ToolchainAssets.fromBase("/toolchain")) {
    this.compiler = new WorkerCppWasmCompiler(wrapEventTargetWorker(createCompilerWorker()), assets);
    this.executor = new WasmExecutor(wrapEventTargetWorker(createExecutorWorker()));
    this.workerCreateCount = 2;
  }

  async warmup(): Promise<void> {
    await Promise.all([this.compiler.warmup(), this.executor.warmup()]);
  }
}

export function createCompilerWorker(): Worker {
  return new Worker(new URL("../workers/compiler.worker.ts", import.meta.url), { type: "module" });
}

export function createExecutorWorker(): Worker {
  return new Worker(new URL("../workers/executor.worker.ts", import.meta.url), { type: "module" });
}

export function createBrowserCppRuntime(assets = ToolchainAssets.fromBase("/toolchain")): BrowserCppRuntime {
  return new BrowserCppRuntime(assets);
}
