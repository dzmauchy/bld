import { CppWasmCompiler } from "../compiler.ts";
import type { CompilerRequest, WorkerResponse } from "../messages.ts";
import type { WorkerMessageHandler } from "./host.ts";

function isCompilerRequest(data: unknown): data is CompilerRequest {
  return Boolean(data && typeof data === "object" && "type" in data);
}

export function compilerHandler(compiler: CppWasmCompiler): WorkerMessageHandler {
  return async (data, progress): Promise<WorkerResponse> => {
    if (!isCompilerRequest(data)) throw new Error("invalid compiler worker message");
    if (data.type === "init") {
      await compiler.initialize();
      return { id: data.id, type: "ok" };
    }
    if (data.type === "compile") {
      const wasm = await compiler.compile(new Map(Object.entries(data.files)), (event) => progress({ id: data.id, type: "progress", progress: event }));
      return { id: data.id, type: "ok", files: { "/work/a.wasm": wasm } };
    }
    if (data.type === "dump-ast") {
      const dump = await compiler.dumpAst(new Map(Object.entries(data.files)), data.mainFile);
      return { id: data.id, type: "ok", result: dump.ok ? 0 : 1, ast: dump.ast, stdout: dump.stdout, stderr: dump.stderr };
    }
    throw new Error(`unknown compiler worker message ${(data as { type?: string }).type}`);
  };
}
