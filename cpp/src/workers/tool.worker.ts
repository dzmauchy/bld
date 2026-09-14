import { EmscriptenFileSystem, type EmscriptenFsApi } from "../filesystem.ts";
import type { FilePayload, ToolInitRequest, ToolRunRequest, WorkerResponse } from "../messages.ts";
import { SysrootInstaller } from "../sysroot.ts";
import { attachWorker } from "./host.ts";

type CreateModule = (options: {
  noInitialRun?: boolean;
  thisProgram?: string;
  locateFile?: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<EmscriptenModule>;

type EmscriptenModule = {
  FS: EmscriptenFsApi;
  callMain: (args: string[]) => number | void;
};

function isToolInit(data: unknown): data is ToolInitRequest {
  return Boolean(data && typeof data === "object" && (data as { type?: string }).type === "init");
}

function isToolRun(data: unknown): data is ToolRunRequest {
  return Boolean(data && typeof data === "object" && (data as { type?: string }).type === "run");
}

function exitStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export class EmscriptenToolSession {
  private module: EmscriptenModule | undefined;
  private fs: EmscriptenFileSystem | undefined;
  private stdout: string[] = [];
  private stderr: string[] = [];
  private resourceDir = "/sysroot/lib/clang/23";

  async init(request: ToolInitRequest): Promise<{ resourceDir: string }> {
    const createModule = await this.loadCreateModule(request.moduleUrl);
    this.stdout = [];
    this.stderr = [];
    this.module = await createModule({
      noInitialRun: true,
      thisProgram: request.thisProgram,
      locateFile: (path, prefix) => (path.endsWith(".wasm") ? request.wasmUrl : `${prefix}${path}`),
      print: (text) => {
        this.stdout.push(text);
      },
      printErr: (text) => {
        this.stderr.push(text);
      },
    });
    this.fs = new EmscriptenFileSystem(this.module.FS);
    const installer = new SysrootInstaller(this.fs);
    const response = await fetch(request.sysrootUrl);
    if (!response.ok || !response.body) {
      throw new Error(`failed to fetch sysroot: ${response.status} ${response.statusText}`);
    }
    const installed = await installer.install(response.body, request.sysrootKind, true);
    this.resourceDir = installed.resourceDir;
    this.fs.mkdirTree("/work");
    return { resourceDir: this.resourceDir };
  }

  run(request: ToolRunRequest): { files: Record<string, Uint8Array>; stdout: string; stderr: string } {
    const module = this.requireModule();
    const fs = this.requireFs();
    this.stdout = [];
    this.stderr = [];
    if (request.resetWork) {
      fs.removeTree("/work");
      fs.mkdirTree("/work");
    }
    for (const file of request.files) this.writePayload(fs, file);
    fs.chdir("/work");
    const code = this.callMain(module, request.args);
    const logs = {
      stdout: this.stdout.join("\n"),
      stderr: this.stderr.join("\n"),
    };
    if (code !== 0) {
      const details = [logs.stderr, logs.stdout].filter(Boolean).join("\n");
      throw new Error(`${request.args[0] ?? "tool"} exited with ${code}${details ? `\n${details}` : ""}`);
    }
    const files: Record<string, Uint8Array> = {};
    for (const path of request.read) {
      files[path] = fs.readFile(path);
    }
    return { files, ...logs };
  }

  get detectedResourceDir(): string {
    return this.resourceDir;
  }

  private writePayload(fs: EmscriptenFileSystem, file: FilePayload): void {
    if (file.text !== undefined) {
      fs.writeTree(file.path, file.text);
      return;
    }
    if (file.bytes) {
      fs.writeTree(file.path, file.bytes);
    }
  }

  private callMain(module: EmscriptenModule, args: string[]): number {
    try {
      const code = module.callMain(args);
      return typeof code === "number" ? code : 0;
    } catch (error) {
      const status = exitStatus(error);
      if (status !== undefined) return status;
      throw error;
    }
  }

  private async loadCreateModule(url: string): Promise<CreateModule> {
    const imported = await import(/* webpackIgnore: true */ url) as { default: CreateModule };
    if (typeof imported.default !== "function") {
      throw new Error(`module at ${url} does not export createModule`);
    }
    return imported.default;
  }

  private requireModule(): EmscriptenModule {
    if (!this.module) throw new Error("emscripten tool is not initialized");
    return this.module;
  }

  private requireFs(): EmscriptenFileSystem {
    if (!this.fs) throw new Error("emscripten filesystem is not initialized");
    return this.fs;
  }
}

const session = new EmscriptenToolSession();

attachWorker(async (data): Promise<WorkerResponse> => {
  if (isToolInit(data)) {
    const result = await session.init(data);
    return { id: data.id, type: "ok", resourceDir: result.resourceDir };
  }
  if (isToolRun(data)) {
    const result = session.run(data);
    return {
      id: data.id,
      type: "ok",
      files: result.files,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
  throw new Error(`unknown tool worker message ${String((data as { type?: string }).type)}`);
});
