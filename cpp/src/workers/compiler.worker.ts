import clangCreateModule from "clang-emscripten";
import lldCreateModule from "lld-emscripten";
import { ClangFrontend } from "../clang.ts";
import { CppWasmCompiler } from "../compiler.ts";
import { WasmLinker } from "../linker.ts";
import type { CompilerRequest, WorkerResponse } from "../messages.ts";
import { attachWorker } from "./host.ts";

const clangWasmUrl = new URL("../../assets/clang.wasm", import.meta.url).href;
const lldWasmUrl = new URL("../../assets/lld.wasm", import.meta.url).href;
const sysrootUrl = new URL("../../assets/sysroot.tgz", import.meta.url).href;

export class CompilerWorkerSession {
  private readonly compiler = new CppWasmCompiler(
    new ClangFrontend(clangCreateModule, clangWasmUrl),
    new WasmLinker(lldCreateModule, lldWasmUrl),
    sysrootUrl,
  );

  async init(): Promise<void> {
    await this.compiler.initialize();
  }

  async compile(files: Record<string, string>): Promise<Uint8Array> {
    return this.compiler.compile(new Map(Object.entries(files)));
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
  throw new Error(`unknown compiler worker message ${(data as { type?: string }).type}`);
});
