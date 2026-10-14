import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";
import { DefaultWasmBindings } from "cpp/bindings.ts";
import { CppWasmCompiler } from "cpp/compiler.ts";
import { ClangDumpResult, ClangAstDumper } from "cpp/clangAstDumper.ts";

/** Owns a real HTTP asset server and a lazy Wasm compiler for integration tests. */
export class TestToolchain extends ClangAstDumper {
  private readonly release = new LlvmProjectRelease();
  private readonly directory = fileURLToPath(new URL(`../test-results/toolchain/${LlvmProjectRelease.tag}/`, import.meta.url));
  private readonly server = createServer((request, response) => this.serve(request, response));
  private readonly requestedAssets: string[] = [];
  private readonly failures = new Map<string, number>();
  private ready: Promise<void> | undefined;
  private compiler: CppWasmCompiler | undefined;

  get requests(): readonly string[] { return this.requestedAssets.slice(); }

  open(): Promise<void> {
    return this.ready ??= this.prepare().catch((error: unknown) => {
      this.ready = undefined;
      throw error;
    });
  }

  assetUrl(name: string): string {
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Toolchain asset server is not open");
    return `http://127.0.0.1:${address.port}/${name}`;
  }

  createCompiler(): CppWasmCompiler {
    return new CppWasmCompiler(name => this.assetUrl(name));
  }

  failNext(name: string): void {
    this.failures.set(name, (this.failures.get(name) ?? 0) + 1);
  }

  override async dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult> {
    await this.open();
    const result = await (this.compiler ??= this.createCompiler()).dumpAst(files, mainFile);
    return new ClangDumpResult(result.ok, result.ast, result.stdout, result.stderr);
  }

  async close(): Promise<void> {
    await this.ready;
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => this.server.close(error => error ? reject(error) : resolve()));
    this.compiler = undefined;
    this.ready = undefined;
  }

  static async execute(wasm: Uint8Array): Promise<WebAssembly.Exports> {
    const module = await WebAssembly.compile(new Uint8Array(wasm));
    const instance = await WebAssembly.instantiate(module, new DefaultWasmBindings().fill(module));
    (instance.exports.wasm_initialize as () => void)();
    return instance.exports;
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await Promise.all(LlvmProjectRelease.files.map(name => this.download(name)));
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  private async download(name: string): Promise<void> {
    const path = `${this.directory}/${name}`;
    try { if ((await stat(path)).size > 0) return; } catch { /* First run downloads the pinned release. */ }
    const response = await fetch(this.release.assetUrl(name));
    if (!response.ok) throw new Error(`Failed to download ${name}: ${response.status}`);
    const download = `${path}.${process.pid}.download`;
    await writeFile(download, new Uint8Array(await response.arrayBuffer()));
    await rename(download, path);
  }

  private serve(request: IncomingMessage, response: ServerResponse): void {
    const name = request.url?.slice(1) ?? "";
    this.requestedAssets.push(name);
    const failures = this.failures.get(name) ?? 0;
    if (failures) {
      this.failures.set(name, failures - 1);
      response.writeHead(503).end("temporarily unavailable");
    } else if ((LlvmProjectRelease.files as readonly string[]).includes(name)) {
      response.writeHead(200, { "Content-Type": this.release.contentType(name) });
      createReadStream(`${this.directory}/${name}`).pipe(response);
    } else response.writeHead(404).end();
  }
}
