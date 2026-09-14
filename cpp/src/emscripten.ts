import { formatUnknownError, exitStatus, isAbortError } from "./errors.ts";
import { EmscriptenFileSystem, type EmscriptenFsApi } from "./filesystem.ts";
import type { SysrootInstallKind } from "./messages.ts";
import { SysrootInstaller } from "./sysroot.ts";

export type EmscriptenModuleOptions = {
  noInitialRun?: boolean;
  noExitRuntime?: boolean;
  thisProgram?: string;
  locateFile?: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
};

export type EmscriptenRuntime = {
  FS: EmscriptenFsApi;
  callMain: (args: string[]) => number | void;
};

export type EmscriptenModuleFactory = (options?: EmscriptenModuleOptions) => Promise<EmscriptenRuntime>;

export function copyOut(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * One reusable Emscripten clang or lld instance with its own MEMFS.
 */
export abstract class EmscriptenTool {
  private runtime: EmscriptenRuntime | undefined;
  private fs: EmscriptenFileSystem | undefined;
  private wasmUrl = "";
  private sysrootArchive: ArrayBuffer | undefined;
  private sysrootKind: SysrootInstallKind | undefined;
  private stdout: string[] = [];
  private stderr: string[] = [];

  protected constructor(
    private readonly createModule: EmscriptenModuleFactory,
    private readonly programName: string,
  ) {}

  async boot(wasmUrl: string): Promise<void> {
    this.wasmUrl = wasmUrl;
    this.stdout = [];
    this.stderr = [];
    this.runtime = await this.createModule({
      noInitialRun: true,
      noExitRuntime: true,
      thisProgram: this.programName,
      locateFile: (path, prefix) => (path.endsWith(".wasm") ? wasmUrl : `${prefix}${path}`),
      print: (text) => {
        this.stdout.push(text);
      },
      printErr: (text) => {
        this.stderr.push(text);
      },
    });
    this.fs = new EmscriptenFileSystem(this.runtime.FS);
    this.fs.mkdirTree("/work");
  }

  async installSysroot(archive: ArrayBuffer, kind: SysrootInstallKind): Promise<string> {
    this.sysrootArchive = archive;
    this.sysrootKind = kind;
    const installer = new SysrootInstaller(this.requireFs());
    const installed = await installer.install(archive, kind, true);
    this.onSysrootInstalled(installed.resourceDir);
    return installed.resourceDir;
  }

  resetWork(): void {
    const fs = this.requireFs();
    fs.chdir("/");
    fs.removeTree("/work");
    fs.mkdirTree("/work");
  }

  writeText(path: string, text: string): void {
    this.requireFs().writeTree(path, text);
  }

  writeBytes(path: string, bytes: Uint8Array): void {
    this.requireFs().writeTree(path, bytes);
  }

  readCopy(path: string): Uint8Array {
    return copyOut(this.requireFs().readFile(path));
  }

  async runMainAsync(args: string[]): Promise<void> {
    try {
      this.executeMain(args);
    } catch (error) {
      if (!isAbortError(error) || !this.wasmUrl) throw error;
      await this.recoverFromAbort();
      this.executeMain(args);
    }
  }

  get logs(): { stdout: string; stderr: string } {
    return {
      stdout: this.stdout.join("\n"),
      stderr: this.stderr.join("\n"),
    };
  }

  protected onSysrootInstalled(_resourceDir: string): void {}

  private async recoverFromAbort(): Promise<void> {
    await this.boot(this.wasmUrl);
    if (this.sysrootArchive && this.sysrootKind) {
      await this.installSysroot(this.sysrootArchive, this.sysrootKind);
    }
  }

  private executeMain(args: string[]): void {
    const runtime = this.requireRuntime();
    this.stdout = [];
    this.stderr = [];
    this.requireFs().chdir("/work");
    const code = this.callMain(runtime, [...args]);
    if (code !== 0) {
      const details = [this.logs.stderr, this.logs.stdout].filter(Boolean).join("\n");
      throw new Error(`${this.programName} exited with ${code}${details ? `\n${details}` : ""}`);
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

  private requireFs(): EmscriptenFileSystem {
    if (!this.fs) throw new Error(`${this.programName} filesystem is not initialized`);
    return this.fs;
  }
}
