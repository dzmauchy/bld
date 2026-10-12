import { ClangFrontend } from "./clang.ts";
import { WasmLinker } from "./linker.ts";
import { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";
import { SysrootInstaller } from "./sysroot.ts";
import { CompilationProgressEmitter, type CompilationPhaseListener } from "./compilationProgress.ts";

/** Compiles C++ sources to wasm. Callers pass files; the compiler does not know the diagram model. */
export interface ICppCompiler {
  compile(files: Map<string, string>, listener?: CompilationPhaseListener): Promise<Uint8Array>;
}

/**
 * Compiles a Map of C++ sources/headers to a wasm module by running clang
 * then wasm-ld. Instantiated inside the single compiler worker with tools
 * backed by clang, lld, and the sysroot archive from the clang-wasm release.
 */
export class CppWasmCompiler extends CompilationProgressEmitter implements ICppCompiler {
  private ready: Promise<void> | undefined;

  constructor(
    private readonly clang: ClangFrontend,
    private readonly linker: WasmLinker,
    private readonly sysrootUrl: string,
  ) {
    super();
    if (clang.sharedFileSystem !== linker.sharedFileSystem) {
      throw new Error("clang and lld must use the same shared filesystem");
    }
  }

  async initialize(): Promise<void> {
    this.ready ??= this.boot().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    await this.ready;
  }

  private async boot(): Promise<void> {
    // Let both boots finish before a failed initialization can be retried.
    const boots = await Promise.allSettled([this.clang.boot(), this.linker.boot()]);
    for (const boot of boots) {
      if (boot.status === "rejected") throw boot.reason;
    }
    const archive = await this.fetchSysroot();
    await new SysrootInstaller(this.clang.sharedFileSystem).install(archive);
  }

  async compile(files: Map<string, string>, listener?: CompilationPhaseListener): Promise<Uint8Array> {
    this.notifyPhase({ phase: "compilation", status: "active" }, listener);
    const objects = await this.clang.compile(files);
    this.notifyPhase({ phase: "compilation", status: "completed" }, listener);
    this.notifyPhase({ phase: "linking", status: "active" }, listener);
    const wasm = await this.linker.link(objects);
    this.notifyPhase({ phase: "linking", status: "completed" }, listener);
    return wasm;
  }

  async dumpAst(
    files: Map<string, string>,
    mainFile: string,
  ): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    return this.clang.dumpAst(files, mainFile);
  }

  private async fetchSysroot(): Promise<ArrayBuffer> {
    const response = await fetch(this.sysrootUrl);
    if (!response.ok) {
      throw new Error(`failed to fetch sysroot: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }
}

/**
 * Main-thread handle to exactly one clang/lld worker that runs {@link CppWasmCompiler}.
 */
export class WorkerCppWasmCompiler extends CompilationProgressEmitter implements ICppCompiler {
  private readonly client: RpcClient;
  private ready: Promise<void> | undefined;

  constructor(thread: Thread) {
    super();
    this.client = new RpcClient(thread);
  }

  /** Shared preparation promise used by startup, AST analysis, and compilation. */
  warmup(): Promise<void> {
    this.ready ??= this.init().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  async compile(files: Map<string, string>, listener?: CompilationPhaseListener): Promise<Uint8Array> {
    this.notifyPhase({ phase: "awaiting-modules", status: "active" }, listener);
    await this.warmup();
    this.notifyPhase({ phase: "awaiting-modules", status: "completed" }, listener);
    const response = await this.client.request({
      type: "compile",
      files: Object.fromEntries(files),
    }, false, (message) => this.notifyPhase(message.progress, listener));
    const wasm = response.files?.["/work/a.wasm"];
    if (!wasm) throw new Error("compiler did not produce a wasm module");
    return wasm;
  }

  async dumpAst(
    files: Map<string, string>,
    mainFile: string,
  ): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    await this.warmup();
    const response = await this.client.request({
      type: "dump-ast",
      files: Object.fromEntries(files),
      mainFile,
    });
    return {
      ok: (response.result ?? 1) === 0,
      ast: response.ast,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    };
  }

  async close(): Promise<void> {
    this.ready = undefined;
    await this.client.terminate();
  }

  private async init(): Promise<void> {
    await this.client.request({ type: "init" });
  }
}
