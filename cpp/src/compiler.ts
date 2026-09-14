import { ClangFrontend } from "./clang.ts";
import { WasmLinker } from "./linker.ts";
import { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";

/**
 * Compiles a Map of C++ sources/headers to a wasm module by running clang
 * then wasm-ld. Instantiated inside the single compiler worker with tools
 * backed by the imported clang.js / lld.js modules and static wasm/sysroot assets.
 */
export class CppWasmCompiler {
  constructor(
    private readonly clang: ClangFrontend,
    private readonly linker: WasmLinker,
    private readonly sysrootUrl: string,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([this.clang.boot(), this.linker.boot()]);
    const archive = await this.fetchSysroot();
    await this.clang.installSysroot(archive, "headers");
    await this.linker.installSysroot(archive, "libraries");
  }

  async compile(files: Map<string, string>): Promise<Uint8Array> {
    const objects = await this.clang.compile(files);
    return this.linker.link(objects);
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
export class WorkerCppWasmCompiler {
  private readonly client: RpcClient;
  private ready: Promise<void> | undefined;

  constructor(thread: Thread) {
    this.client = new RpcClient(thread);
  }

  async warmup(): Promise<void> {
    this.ready ??= this.init();
    await this.ready;
  }

  async compile(files: Map<string, string>): Promise<Uint8Array> {
    await this.warmup();
    const response = await this.client.request({
      type: "compile",
      files: Object.fromEntries(files),
    });
    const wasm = response.files?.["/work/a.wasm"];
    if (!wasm) throw new Error("compiler did not produce a wasm module");
    return wasm;
  }

  async close(): Promise<void> {
    this.ready = undefined;
    await this.client.terminate();
  }

  private async init(): Promise<void> {
    await this.client.request({ type: "init" });
  }
}
