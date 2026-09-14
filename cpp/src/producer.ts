import { ClangArgumentBuilder, LldArgumentBuilder } from "./args.ts";
import type { ToolchainAssets } from "./assets.ts";
import { filePayload, type FilePayload } from "./messages.ts";
import { isCppSource, objectPathFor, workPath } from "./paths.ts";
import { WorkerPool } from "./pool.ts";
import type { RpcClient } from "./rpc.ts";
import type { Thread } from "./thread.ts";

export type CppProducerOptions = {
  pool?: WorkerPool;
  clang: Thread | (() => Thread);
  lld: Thread | (() => Thread);
  assets: ToolchainAssets;
  clangArgs?: ClangArgumentBuilder;
  lldArgs?: LldArgumentBuilder;
};

export class CppWasmProducer {
  private readonly pool: WorkerPool;
  private readonly assets: ToolchainAssets;
  private clangArgs: ClangArgumentBuilder;
  private readonly lldArgs: LldArgumentBuilder;
  private readonly clangFactory: () => Thread;
  private readonly lldFactory: () => Thread;
  private clangReady: Promise<RpcClient> | undefined;
  private lldReady: Promise<RpcClient> | undefined;

  constructor(options: CppProducerOptions) {
    this.pool = options.pool ?? new WorkerPool();
    this.assets = options.assets;
    this.clangArgs = options.clangArgs ?? new ClangArgumentBuilder();
    this.lldArgs = options.lldArgs ?? new LldArgumentBuilder();
    this.clangFactory = typeof options.clang === "function" ? options.clang : () => options.clang as Thread;
    this.lldFactory = typeof options.lld === "function" ? options.lld : () => options.lld as Thread;
  }

  get workerCreateCount(): number {
    return this.pool.createCount;
  }

  async warmup(): Promise<void> {
    await Promise.all([this.ensureClang(), this.ensureLld()]);
  }

  async compile(files: Map<string, string>): Promise<Uint8Array> {
    const sources = [...files.keys()].filter((name) => isCppSource(name));
    if (sources.length === 0) throw new Error("no C or C++ source files to compile");

    const userFiles = [...files.entries()].map(([path, text]) => filePayload(workPath(path), text));
    const clang = await this.ensureClang();
    const objects: FilePayload[] = [];
    const objectPaths: string[] = [];

    for (const source of sources) {
      const objectPath = objectPathFor(source);
      const compiled = await clang.request({
        type: "run",
        files: userFiles,
        args: this.clangArgs.build(workPath(source), objectPath),
        read: [objectPath],
        resetWork: true,
      });
      const bytes = compiled.files?.[objectPath];
      if (!bytes) throw new Error(`clang did not produce ${objectPath}`);
      objects.push(filePayload(objectPath, bytes));
      objectPaths.push(objectPath);
    }

    const lld = await this.ensureLld();
    const outputPath = "/work/a.wasm";
    const linked = await lld.request({
      type: "run",
      files: objects,
      args: this.lldArgs.build(objectPaths, outputPath),
      read: [outputPath],
      resetWork: true,
    });
    const wasm = linked.files?.[outputPath];
    if (!wasm) throw new Error("lld did not produce a wasm module");
    return wasm;
  }

  async close(): Promise<void> {
    this.clangReady = undefined;
    this.lldReady = undefined;
    await this.pool.close();
  }

  private ensureClang(): Promise<RpcClient> {
    this.clangReady ??= this.initTool("clang", this.clangFactory, {
      moduleUrl: this.assets.clangJs,
      wasmUrl: this.assets.clangWasm,
      thisProgram: "clang++",
      sysrootKind: "headers",
    });
    return this.clangReady;
  }

  private ensureLld(): Promise<RpcClient> {
    this.lldReady ??= this.initTool("lld", this.lldFactory, {
      moduleUrl: this.assets.lldJs,
      wasmUrl: this.assets.lldWasm,
      thisProgram: "wasm-ld",
      sysrootKind: "libraries",
    });
    return this.lldReady;
  }

  private async initTool(
    name: string,
    factory: () => Thread,
    init: {
      moduleUrl: string;
      wasmUrl: string;
      thisProgram: string;
      sysrootKind: "headers" | "libraries";
    },
  ): Promise<RpcClient> {
    const client = this.pool.acquire(name, factory);
    const response = await client.request({
      type: "init",
      moduleUrl: init.moduleUrl,
      wasmUrl: init.wasmUrl,
      sysrootUrl: this.assets.sysroot,
      thisProgram: init.thisProgram,
      sysrootKind: init.sysrootKind,
    });
    if (name === "clang" && response.resourceDir) {
      this.clangArgs = this.clangArgs.withResourceDir(response.resourceDir);
    }
    return client;
  }
}
