import { formatUnknownError, exitStatus, isAbortError } from "./errors.ts";
import { EmscriptenFileSystem, type EmscriptenFsApi } from "./filesystem.ts";
import { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export type EmscriptenModuleOptions = {
  noInitialRun?: boolean;
  noExitRuntime?: boolean;
  thisProgram?: string;
  locateFile?: (path: string, prefix: string) => string;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance) => void,
  ) => unknown;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
};

type StdioStream = {
  tty?: {
    ops?: {
      fsync?: (tty: unknown) => void;
    };
  };
};

export type EmscriptenRuntime = {
  FS: EmscriptenFsApi;
  PROXYFS: unknown;
  callMain: (args: string[]) => number | void;
};

export type EmscriptenModuleFactory = (options?: EmscriptenModuleOptions) => Promise<EmscriptenRuntime>;

/** Disposable clang/lld runtimes mounting one persistent PROXYFS owner. */
export abstract class EmscriptenTool {
  private runtime: EmscriptenRuntime | undefined;
  private stdout: string[] = [];
  private stderr: string[] = [];

  protected constructor(
    private readonly createModule: EmscriptenModuleFactory,
    private readonly programName: string,
    private readonly wasmUrl: string,
    private readonly sharedFiles: SharedToolchainFileSystem,
  ) {}

  get sharedFileSystem(): SharedToolchainFileSystem {
    return this.sharedFiles;
  }

  async boot(): Promise<void> {
    this.runtime = undefined;
    this.stdout = [];
    this.stderr = [];
    this.runtime = await this.createModule({
      noInitialRun: true,
      noExitRuntime: true,
      thisProgram: this.programName,
      locateFile: (path, prefix) => (path.endsWith(".wasm") ? this.wasmUrl : `${prefix}${path}`),
      print: (text) => {
        this.stdout.push(text);
      },
      printErr: (text) => {
        this.stderr.push(text);
      },
    });
    if (!this.runtime.PROXYFS || !this.runtime.FS.mount) {
      this.runtime = undefined;
      throw new Error(`${this.programName} must export FS.mount and PROXYFS`);
    }
    const fs = new EmscriptenFileSystem(this.runtime.FS);
    for (const path of SharedToolchainFileSystem.mountPaths) {
      fs.mkdirTree(path);
      this.runtime.FS.mount(this.runtime.PROXYFS, { root: path, fs: this.sharedFiles }, path);
    }
  }

  async recycle(): Promise<void> {
    // Instantiate only when the next invocation needs it. The shared owner
    // retains files, never a disposable tool runtime or its Wasm heap.
    this.runtime = undefined;
  }

  prepareWork(): void {
    this.requireRuntime().FS.chdir("/");
    this.sharedFiles.mkdirTree("/work");
  }

  writeText(path: string, text: string): void {
    this.sharedFiles.writeTree(path, text);
  }

  readCopy(path: string): Uint8Array {
    return this.sharedFiles.readFile(path);
  }

  async runMainAsync(args: string[]): Promise<void> {
    await this.ensureReady();
    this.executeMain(args);
  }

  protected async ensureReady(): Promise<void> {
    if (!this.runtime) await this.boot();
  }

  runMainCapture(args: string[]): { code: number; stdout: string; stderr: string } {
    const runtime = this.requireRuntime();
    this.stdout = [];
    this.stderr = [];
    runtime.FS.chdir("/");
    const code = this.callMain(runtime, [...args]);
    this.flushStdio(runtime);
    return { code, stdout: this.logs.stdout, stderr: this.logs.stderr };
  }

  get logs(): { stdout: string; stderr: string } {
    return {
      stdout: this.stdout.join("\n"),
      stderr: this.stderr.join("\n"),
    };
  }

  protected async runJob<T>(job: () => Promise<T>): Promise<T> {
    try {
      await this.ensureReady();
      return await job();
    } catch (error) {
      if (!this.canRecover(error) || !this.wasmUrl) throw error;
      await this.recoverFromAbort();
      return job();
    }
  }

  private canRecover(error: unknown): boolean {
    if (isAbortError(error)) return true;
    const message = error instanceof Error ? error.message : formatUnknownError(error);
    return /no such file or directory/i.test(message);
  }

  private async recoverFromAbort(): Promise<void> {
    await this.recycle();
  }

  private executeMain(args: string[]): void {
    const { code, stdout, stderr } = this.runMainCapture(args);
    if (code !== 0) {
      const details = [stderr, stdout].filter(Boolean).join("\n");
      throw new Error(`${this.programName} exited with ${code}${details ? `\n${details}` : ""}`);
    }
  }

  private flushStdio(runtime: EmscriptenRuntime): void {
    const streams = (runtime.FS as { streams?: StdioStream[] }).streams;
    if (!streams) return;
    for (const fd of [1, 2]) {
      const tty = streams[fd]?.tty;
      try {
        tty?.ops?.fsync?.(tty);
      } catch {
        // A closed stdio stream has nothing left to flush.
      }
    }
  }

  private callMain(runtime: EmscriptenRuntime, args: string[]): number {
    try {
      const code = runtime.callMain(args);
      return typeof code === "number" ? code : 0;
    } catch (error) {
      const status = exitStatus(error);
      if (status !== undefined) return status;
      throw new Error(formatUnknownError(error));
    }
  }

  private requireRuntime(): EmscriptenRuntime {
    if (!this.runtime) throw new Error(`${this.programName} is not initialized`);
    return this.runtime;
  }
}
