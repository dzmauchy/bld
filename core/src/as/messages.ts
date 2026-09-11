export type CompileFiles = Record<string, string>;

export type CompileOptions = {
  debug?: boolean;
  optimizeLevel?: number;
};

export type CompileInitRequest = {
  type: "init";
  id: number;
  files: CompileFiles;
};

export type CompileCompileRequest = {
  type: "compile";
  id: number;
  source: string;
  files?: CompileFiles;
  options?: CompileOptions;
};

export type CompileRequest = CompileInitRequest | CompileCompileRequest;

export type RunInstantiateRequest = {
  type: "instantiate";
  id: number;
  wasm: Uint8Array;
};

export type RunInvokeRequest = {
  type: "invoke";
  id: number;
  name: string;
  args: number[];
};

export type RunRequest = RunInstantiateRequest | RunInvokeRequest;

export type WorkerOk = {
  id: number;
  type: "ok";
  wasm?: Uint8Array;
  result?: number;
};

export type WorkerErr = {
  id: number;
  type: "error";
  message: string;
};

export type WorkerResponse = WorkerOk | WorkerErr;

export function messageId(data: unknown): number {
  if (data !== null && typeof data === "object" && "id" in data) {
    const id = (data as { id: unknown }).id;
    if (typeof id === "number") return id;
  }
  return -1;
}
