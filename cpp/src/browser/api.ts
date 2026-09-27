import { WorkerCppWasmCompiler } from "../compiler.ts";
import { WasmExecutor } from "../executor.ts";
import { wrapEventTargetWorker } from "../thread.ts";

export type CppPageApi = {
  precompileHeaders(files: Record<string, string>): Promise<void>;
  dumpAst(files: Record<string, string>, mainFile: string): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }>;
  warmup(): Promise<void>;
  compile(files: Record<string, string>): Promise<number>;
  compileOnly(files: Record<string, string>): Promise<number>;
  instantiateLast(): Promise<number>;
  invoke(name: string, args: number[]): Promise<number>;
  compileAndInvoke(files: Record<string, string>, name: string, args: number[]): Promise<number>;
  workerCreateCount(): number;
  close(): Promise<void>;
};

/** Owns reusable compiler and execution workers for the lifetime of a browser session. */
export class BrowserCppRuntime {
  private static sharedRuntime: BrowserCppRuntime | undefined;
  private compilerInstance: WorkerCppWasmCompiler | undefined;
  private executorInstance: WasmExecutor | undefined;
  private createdWorkers = 0;
  private closed = false;

  /** Reuses workers across AST analysis and compilation until close() is called. */
  static shared(): BrowserCppRuntime {
    return this.sharedRuntime ??= new BrowserCppRuntime();
  }

  get compiler(): WorkerCppWasmCompiler {
    this.requireOpen();
    if (!this.compilerInstance) {
      this.compilerInstance = new WorkerCppWasmCompiler(wrapEventTargetWorker(createCompilerWorker()));
      this.createdWorkers += 1;
    }
    return this.compilerInstance;
  }

  get executor(): WasmExecutor {
    this.requireOpen();
    if (!this.executorInstance) {
      this.executorInstance = new WasmExecutor(wrapEventTargetWorker(createExecutorWorker()));
      this.createdWorkers += 1;
    }
    return this.executorInstance;
  }

  get workerCreateCount(): number {
    return this.createdWorkers;
  }

  async warmup(): Promise<void> {
    await Promise.all([this.compiler.warmup(), this.executor.warmup()]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (BrowserCppRuntime.sharedRuntime === this) BrowserCppRuntime.sharedRuntime = undefined;
    await Promise.all([this.compilerInstance?.close(), this.executorInstance?.close()]);
  }

  private requireOpen(): void {
    if (this.closed) throw new Error("C++ runtime is closed");
  }
}

export function createCompilerWorker(): Worker {
  return new Worker(new URL("../workers/compiler.worker.ts", import.meta.url), { type: "module" });
}

export function createExecutorWorker(): Worker {
  return new Worker(new URL("../workers/executor.worker.ts", import.meta.url), { type: "module" });
}

/** Creates an independently owned runtime. Use BrowserCppRuntime.shared() to share workers. */
export function createBrowserCppRuntime(): BrowserCppRuntime {
  return new BrowserCppRuntime();
}
