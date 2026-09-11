export type SysrootInstallKind = "headers" | "libraries";

export type WorkerOk = {
  id: number;
  type: "ok";
  files?: Record<string, Uint8Array>;
  resourceDir?: string;
  result?: number;
  stdout?: string;
  stderr?: string;
  exports?: string[];
  ast?: unknown;
  astText?: string;
};

export type WorkerErr = {
  id: number;
  type: "error";
  message: string;
  stderr?: string;
};

export type WorkerResponse = WorkerOk | WorkerErr;

export type FilePayload = {
  path: string;
  text?: string;
  bytes?: Uint8Array;
};

export type CompilerInitRequest = {
  type: "init";
  id: number;
};

export type CompilerCompileRequest = {
  type: "compile";
  id: number;
  files: Record<string, string>;
};

export type CompilerDumpAstRequest = {
  type: "dump-ast";
  id: number;
  files: Record<string, string>;
  mainFile: string;
};

export type CompilerEmitAstRequest = {
  type: "emit-ast";
  id: number;
  files: Record<string, string>;
  mainFile: string;
};

export type CompilerRequest = CompilerInitRequest | CompilerCompileRequest | CompilerDumpAstRequest | CompilerEmitAstRequest;

export type ExecutorInstantiateRequest = {
  type: "instantiate";
  id: number;
  wasm: Uint8Array;
};

export type ExecutorInvokeRequest = {
  type: "invoke";
  id: number;
  name: string;
  args: number[];
};

export type ExecutorRequest = ExecutorInstantiateRequest | ExecutorInvokeRequest;

export function messageId(data: unknown): number {
  if (data !== null && typeof data === "object" && "id" in data) {
    const id = (data as { id: unknown }).id;
    if (typeof id === "number") return id;
  }
  return -1;
}

export function filePayload(path: string, contents: string | Uint8Array): FilePayload {
  if (typeof contents === "string") return { path, text: contents };
  return { path, bytes: contents };
}
