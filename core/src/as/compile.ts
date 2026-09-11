import asc from "assemblyscript/asc";
import { attachWorker } from "./workerHost.ts";
import type {
  CompileCompileRequest,
  CompileFiles,
  CompileInitRequest,
  CompileOptions,
  CompileRequest,
  WorkerResponse,
} from "./messages.ts";

function normalizePath(filename: string): string {
  return filename.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readVirtual(files: CompileFiles, filename: string): string | null {
  const normalized = normalizePath(filename);
  if (Object.prototype.hasOwnProperty.call(files, normalized)) {
    return files[normalized] ?? null;
  }
  const slash = normalized.lastIndexOf("/");
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  if (Object.prototype.hasOwnProperty.call(files, base)) {
    return files[base] ?? null;
  }
  return null;
}

function listVirtual(files: CompileFiles, dirname: string): string[] {
  const dir = normalizePath(dirname).replace(/\/$/, "");
  const prefix = dir && dir !== "." ? `${dir}/` : "";
  const names: string[] = [];
  for (const key of Object.keys(files)) {
    if (!key.endsWith(".ts") && key !== "tsconfig.json") continue;
    if (prefix && !normalizePath(key).startsWith(prefix)) continue;
    const rest = prefix ? normalizePath(key).slice(prefix.length) : normalizePath(key);
    if (!rest.includes("/")) names.push(rest);
  }
  return names;
}

function compileArgv(options: CompileOptions = {}): string[] {
  const argv = [
    "generated.ts",
    "--outFile",
    "generated.wasm",
    "--exportRuntime",
    "--runtime",
    "incremental",
    "--optimizeLevel",
    String(options.optimizeLevel ?? 0),
  ];
  if (options.debug !== false) argv.push("--debug");
  return argv;
}

/** Compile AssemblyScript using an in-memory file map (browser and Node). */
export async function compileAssembly(
  source: string,
  files: CompileFiles = {},
  options: CompileOptions = {},
): Promise<Uint8Array> {
  const virtual: CompileFiles = { ...files, "generated.ts": source };
  const emitted = new Map<string, string | Uint8Array>();
  const result = await asc.main(compileArgv(options), {
    readFile(filename) {
      return readVirtual(virtual, filename);
    },
    listFiles(dirname) {
      return listVirtual(virtual, dirname);
    },
    writeFile(filename, contents) {
      emitted.set(normalizePath(filename), contents);
    },
  });
  if (result.error) {
    throw new Error(`${result.stderr.toString()}\n${result.error.message}`);
  }
  const wasm = emitted.get("generated.wasm");
  if (!(wasm instanceof Uint8Array)) {
    throw new Error(`asc did not emit wasm. files=${[...emitted.keys()].join(",")}`);
  }
  return wasm;
}

function isInit(message: CompileRequest): message is CompileInitRequest {
  return message.type === "init";
}

function isCompile(message: CompileRequest): message is CompileCompileRequest {
  return message.type === "compile";
}

/** Worker entry: init with library files, then compile generated programs. */
export function startCompileWorker(): void {
  let files: CompileFiles = {};
  attachWorker(async (data): Promise<WorkerResponse> => {
    const message = data as CompileRequest;
    if (isInit(message)) {
      files = { ...message.files };
      return { id: message.id, type: "ok" };
    }
    if (!isCompile(message)) {
      throw new Error(`unknown compile worker message ${(message as { type?: string }).type}`);
    }
    if (message.files) files = { ...files, ...message.files };
    const wasm = await compileAssembly(message.source, files, message.options ?? {});
    return { id: message.id, type: "ok", wasm };
  });
}
