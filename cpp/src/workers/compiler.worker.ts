import { ClangFrontend } from "../clang.ts";
import { CppWasmCompiler } from "../compiler.ts";
import { WasmLinker } from "../linker.ts";
import { LlvmProjectRelease } from "../llvmRelease.ts";
import type { CompilerRequest, WorkerResponse } from "../messages.ts";
import { RemoteEmscriptenModule } from "../remoteEmscripten.ts";
import { attachWorker } from "./host.ts";

const release = new LlvmProjectRelease();
const clangWasmUrl = release.assetUrl("clang.wasm");
const lldWasmUrl = release.assetUrl("lld.wasm");
const sysrootUrl = new URL("../../assets/sysroot.tgz", import.meta.url).href;

export class CompilerWorkerSession {
  private readonly compiler = new CppWasmCompiler(
    new ClangFrontend(new RemoteEmscriptenModule(release.assetUrl("clang.js"), clangWasmUrl).createFactory(), clangWasmUrl),
    new WasmLinker(new RemoteEmscriptenModule(release.assetUrl("lld.js"), lldWasmUrl).createFactory(), lldWasmUrl),
    sysrootUrl,
  );

  async init(): Promise<void> {
    await this.compiler.initialize();
  }

  async compile(files: Record<string, string>): Promise<Uint8Array> {
    return this.compiler.compile(new Map(Object.entries(files)));
  }

  async dumpAst(files: Record<string, string>, mainFile: string): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    return this.compiler.dumpAst(new Map(Object.entries(files)), mainFile);
  }

  async emitAst(files: Record<string, string>, mainFile: string): Promise<{ ok: boolean; astText: string; stdout: string; stderr: string }> {
    return this.compiler.emitAst(new Map(Object.entries(files)), mainFile);
  }
}

function isCompilerRequest(data: unknown): data is CompilerRequest {
  return Boolean(data && typeof data === "object" && "type" in data);
}

const session = new CompilerWorkerSession();

attachWorker(async (data): Promise<WorkerResponse> => {
  if (!isCompilerRequest(data)) throw new Error("invalid compiler worker message");
  if (data.type === "init") {
    await session.init();
    return { id: data.id, type: "ok" };
  }
  if (data.type === "compile") {
    const wasm = await session.compile(data.files);
    return { id: data.id, type: "ok", files: { "/work/a.wasm": wasm } };
  }
  if (data.type === "dump-ast") {
    const dump = await session.dumpAst(data.files, data.mainFile);
    return { id: data.id, type: "ok", result: dump.ok ? 0 : 1, ast: dump.ast, stdout: dump.stdout, stderr: dump.stderr };
  }
  if (data.type === "emit-ast") {
    const dump = await session.emitAst(data.files, data.mainFile);
    return { id: data.id, type: "ok", result: dump.ok ? 0 : 1, astText: dump.astText, stdout: dump.stdout, stderr: dump.stderr };
  }
  throw new Error(`unknown compiler worker message ${(data as { type?: string }).type}`);
});
