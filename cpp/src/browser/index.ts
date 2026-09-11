import { createBrowserCppRuntime, type CppPageApi } from "./api.ts";
import type { ExecutedWasm } from "../executor.ts";

export type { CppPageApi };

const status = document.querySelector("#status");
const log = document.querySelector("#log");
const runtime = createBrowserCppRuntime();
let session: ExecutedWasm | undefined;
let lastWasm: Uint8Array | undefined;

function setStatus(text: string): void {
  if (status) status.textContent = text;
}

function appendLog(text: string): void {
  if (!log) return;
  log.textContent = `${log.textContent ?? ""}${text}\n`;
}

const api: CppPageApi = {
  async warmup() {
    setStatus("warming toolchain");
    appendLog("loading clang/lld compiler worker and executor worker");
    await runtime.warmup();
    setStatus("ready");
    appendLog(`workers created: ${runtime.workerCreateCount}`);
  },
  async compile(files) {
    const bytes = await api.compileOnly(files);
    await api.instantiateLast();
    return bytes;
  },
  async compileOnly(files) {
    setStatus("compiling");
    lastWasm = await runtime.compiler.compile(new Map(Object.entries(files)));
    setStatus("ready");
    appendLog(`compiled ${lastWasm.byteLength} bytes`);
    return lastWasm.byteLength;
  },
  async instantiateLast() {
    if (!lastWasm) throw new Error("no compiled wasm");
    setStatus("instantiating");
    session = await runtime.executor.instantiate(lastWasm);
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
    return runtime.workerCreateCount;
  },
};

Object.defineProperty(window, "cpp", { value: api, writable: false });
setStatus("module-ready");
appendLog("page module loaded");

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}
