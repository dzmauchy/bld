import { ToolchainServiceWorker } from "../toolchainServiceWorker.ts";
import { createBrowserCppRuntime, type CppPageApi } from "./api.ts";
import type { BrowserCppRuntime } from "./api.ts";
import type { ExecutedWasm } from "../executor.ts";

export type { CppPageApi };

const status = document.querySelector("#status");
const log = document.querySelector("#log");
const runtimeReady = new ToolchainServiceWorker().claim().then(() => createBrowserCppRuntime());
let session: ExecutedWasm | undefined;
let lastWasm: Uint8Array | undefined;

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

function appendLog(text: string): void {
  if (!log) return;
  log.textContent = `${log.textContent ?? ""}${text}\n`;
}

async function runtime(): Promise<BrowserCppRuntime> {
  return runtimeReady;
}

const api: CppPageApi = {
  async warmup() {
    setStatus("warming toolchain");
    appendLog("loading clang/lld from the llvm-project release");
    const active = await runtime();
    await active.warmup();
    setStatus("ready");
    appendLog(`workers created: ${active.workerCreateCount}`);
  },
  async compile(files) {
    const bytes = await api.compileOnly(files);
    await api.instantiateLast();
    return bytes;
  },
  async compileOnly(files) {
    setStatus("compiling");
    lastWasm = await (await runtime()).compiler.compile(new Map(Object.entries(files)));
    setStatus("ready");
    appendLog(`compiled ${lastWasm.byteLength} bytes`);
    return lastWasm.byteLength;
  },
  async instantiateLast() {
    if (!lastWasm) throw new Error("no compiled wasm");
    setStatus("instantiating");
    session = await (await runtime()).executor.instantiate(lastWasm);
    setStatus("ready");
    appendLog("instantiated wasm");
    return lastWasm.byteLength;
  },
  async invoke(name, args) {
    if (!session) throw new Error("no wasm session");
    const result = await session.invoke(name, ...args);
    appendLog(`${name}(${args.join(", ")}) = ${result}`);
    return result;
  },
  async compileAndInvoke(files, name, args) {
    await api.compile(files);
    return api.invoke(name, args);
  },
  workerCreateCount() {
    return 2;
  },
};

Object.defineProperty(window, "cpp", { value: api, writable: false });
void runtimeReady.then(() => {
  setStatus("module-ready");
  appendLog("page module loaded");
}).catch((error: unknown) => {
  setStatus("error");
  appendLog(error instanceof Error ? error.message : String(error));
});

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}
