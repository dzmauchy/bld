import { loadEmscriptenModule, type EmscriptenModuleFactory, type EmscriptenRuntime } from "./emscripten.ts";
import { SharedToolchainFileSystem } from "./sharedFileSystem.ts";
import { astPathFor, isCppSource, objectPathFor, workPath } from "./paths.ts";
import { LlvmProjectRelease } from "./llvmRelease.ts";
import { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";
import { SysrootInstaller } from "./sysroot.ts";
import { CompilationProgressEmitter, type CompilationPhaseListener } from "./compilationProgress.ts";
import { exitStatus, formatUnknownError, isAbortError } from "./errors.ts";

export interface ICppCompiler {
  compile(files: Map<string, string>, listener?: CompilationPhaseListener): Promise<Uint8Array>;
}

type Tool = "clang" | "lld";
type ToolResult = { code: number; stdout: string; stderr: string };

/** Runs the released Clang and LLD directly, keeping files and compiled modules across fresh tool heaps. */
export class CppWasmCompiler extends CompilationProgressEmitter implements ICppCompiler {
  private readonly files = new SharedToolchainFileSystem();
  private readonly modules = new Map<Tool, Promise<EmscriptenModuleFactory>>();
  private ready: Promise<void> | undefined;
  private cachedInputs: ReadonlyMap<string, string> | undefined;
  private readonly cachedSources = new Map<string, ToolResult>();

  constructor(private readonly assetUrl = (name: string) => new LlvmProjectRelease().assetUrl(name)) {
    super();
  }

  initialize(): Promise<void> {
    this.ready ??= this.boot().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async boot(): Promise<void> {
    const [clang, lld, sysroot] = await Promise.allSettled([
      this.module("clang"), this.module("lld"),
      fetch(this.assetUrl("sysroot.tgz")).then(async response => {
        if (!response.ok) throw new Error(`failed to fetch sysroot: ${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      }),
    ]);
    // Finish every load before a failed initialization can be retried.
    if (clang.status === "rejected") throw clang.reason;
    if (lld.status === "rejected") throw lld.reason;
    if (sysroot.status === "rejected") throw sysroot.reason;
    const runtime = await clang.value({ noInitialRun: true });
    this.mount(runtime);
    await new SysrootInstaller(runtime.FS).install(sysroot.value);
    // Only shared files and compiled modules survive preparation, never idle Wasm heaps.
  }

  async compile(files: Map<string, string>, listener?: CompilationPhaseListener): Promise<Uint8Array> {
    const sources = [...files.keys()].filter(isCppSource);
    if (sources.length === 0) throw new Error("no C or C++ source files to compile");
    this.validateOutputs(sources);
    await this.initialize();
    this.prepareInputs(files);
    this.notifyPhase({ phase: "compilation", status: "active" }, listener);
    try {
      const pending = sources.filter(source => !this.cachedSources.has(source));
      if (pending.length) {
        const result = await this.invoke("clang", ["-o", "/work/build", ...pending.map(workPath)]);
        this.requireSuccess("clang", result);
        for (const source of pending) this.cachedSources.set(source, result);
      }
      this.notifyPhase({ phase: "compilation", status: "completed" }, listener);
      this.notifyPhase({ phase: "linking", status: "active" }, listener);
      const result = await this.invoke("lld", [
        "--no-entry", "--export-dynamic", "--export=wasm_initialize", "--export-table", "--export-memory",
        "--stack-first", "-z", "stack-size=1048576", "-L", "/sysroot/lib",
        ...sources.map(objectPathFor), "-lbrowser", "-o", "/work/a.wasm",
      ]);
      this.requireSuccess("lld", result);
      const wasm = this.files.readFile("/work/a.wasm");
      this.notifyPhase({ phase: "linking", status: "completed" }, listener);
      return wasm;
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  async dumpAst(files: Map<string, string>, mainFile: string): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    if (!files.has(mainFile) || !isCppSource(mainFile)) throw new Error(`missing C or C++ source: ${mainFile}`);
    this.validateOutputs([...files.keys()].filter(isCppSource));
    await this.initialize();
    this.prepareInputs(files);
    try {
      const result = this.cachedSources.get(mainFile) ?? await this.invoke("clang", ["-o", "/work/build", workPath(mainFile)]);
      let ast: unknown;
      const path = astPathFor(mainFile);
      if (this.files.exists(path)) {
        try {
          ast = JSON.parse(new TextDecoder().decode(this.files.readFile(path)));
        } catch (error) {
          result.stderr = [result.stderr, `Failed to parse ${path} (${this.files.stat(path).size} bytes): ${String(error)}`].filter(Boolean).join("\n");
        }
      }
      const ok = result.code === 0 && ast !== undefined;
      if (ok && this.files.exists(objectPathFor(mainFile))) this.cachedSources.set(mainFile, result);
      else this.invalidate();
      return { ok, ast, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      this.invalidate();
      throw error;
    }
  }

  private module(tool: Tool): Promise<EmscriptenModuleFactory> {
    let pending = this.modules.get(tool);
    if (!pending) {
      pending = loadEmscriptenModule(this.assetUrl(`${tool}.js`), this.assetUrl(`${tool}.wasm`)).catch((error: unknown) => {
        this.modules.delete(tool);
        throw error;
      });
      this.modules.set(tool, pending);
    }
    return pending;
  }

  private mount(runtime: EmscriptenRuntime): void {
    if (!runtime.PROXYFS) throw new Error("clang/lld must export PROXYFS");
    for (const path of SharedToolchainFileSystem.mountPaths) {
      runtime.FS.mkdirTree(path);
      runtime.FS.mount(runtime.PROXYFS, { root: path, fs: this.files }, path);
    }
  }

  private async invoke(tool: Tool, args: string[]): Promise<ToolResult> {
    // A tool runtime is single-use. Retry transient Wasm aborts once with a fresh heap.
    for (let attempt = 0; ; attempt++) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      try {
        const factory = await this.module(tool);
        const runtime = await factory({
          noInitialRun: true, noExitRuntime: true, thisProgram: tool === "lld" ? "wasm-ld" : tool,
          print: line => stdout.push(line), printErr: line => stderr.push(line),
        });
        this.mount(runtime);
        runtime.FS.chdir("/");
        let code: number;
        try {
          code = runtime.callMain(args) ?? 0;
        } catch (error) {
          const status = exitStatus(error);
          if (status === undefined) throw error;
          code = status;
        } finally {
          for (const fd of [1, 2]) {
            const tty = runtime.FS.streams?.[fd]?.tty;
            try { tty?.ops?.fsync?.(tty); } catch { /* Closed stdio has nothing left to flush. */ }
          }
        }
        return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
      } catch (error) {
        if (attempt === 0 && isAbortError(error)) continue;
        const details = [...stderr, ...stdout].join("\n");
        throw new Error(`${tool}: ${formatUnknownError(error)}${details ? `\n${details}` : ""}`, { cause: error });
      }
    }
  }

  private requireSuccess(tool: Tool, result: ToolResult): void {
    if (result.code === 0) return;
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(`${tool} exited with ${result.code}${details ? `\n${details}` : ""}`);
  }

  private prepareInputs(files: ReadonlyMap<string, string>): void {
    // Paired ASTs retain comments, so even metadata-only edits invalidate them.
    if (this.cachedInputs?.size === files.size
      && [...files].every(([name, text]) => this.cachedInputs?.get(name) === text)) return;
    this.invalidate();
    this.files.prepareInputs(files);
    this.cachedInputs = new Map(files);
  }

  private invalidate(): void {
    this.cachedInputs = undefined;
    this.cachedSources.clear();
  }

  private validateOutputs(sources: string[]): void {
    const outputs = new Set<string>();
    for (const source of sources) {
      const path = objectPathFor(source);
      if (outputs.has(path)) throw new Error(`input files map to the same output: ${path}`);
      outputs.add(path);
    }
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
    }, (message) => this.notifyPhase(message.progress, listener));
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
    try {
      await this.client.request({ type: "init" });
    } catch (error) {
      if (!isAbortError(error)) throw error;
      await this.client.request({ type: "init" });
    }
  }
}
