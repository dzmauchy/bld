import { WorkerCppWasmCompiler } from "../compiler.ts";
import { WasmExecutor } from "../executor.ts";
import { wrapEventTargetWorker } from "../thread.ts";

export type CppPageApi = {
  warmup(): Promise<void>;
  compile(files: Record<string, string>): Promise<number>;
  compileOnly(files: Record<string, string>): Promise<number>;
  instantiateLast(): Promise<number>;
  invoke(name: string, args: number[]): Promise<number>;
  compileAndInvoke(files: Record<string, string>, name: string, args: number[]): Promise<number>;
  workerCreateCount(): number;
};

export class BrowserCppRuntime {
  readonly compiler: WorkerCppWasmCompiler;
  readonly executor: WasmExecutor;
  readonly workerCreateCount: number;

  constructor() {
    this.compiler = new WorkerCppWasmCompiler(wrapEventTargetWorker(createCompilerWorker()));
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

export function createBrowserCppRuntime(): BrowserCppRuntime {
  return new BrowserCppRuntime();
}
