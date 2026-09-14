import { createBrowserCppRuntime, type CppPageApi } from "./api.ts";
import type { ExecutedWasm } from "../executor.ts";

export type { CppPageApi };

const status = document.querySelector("#status");
const log = document.querySelector("#log");
const runtime = createBrowserCppRuntime();
let session: ExecutedWasm | undefined;

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
    setStatus("compiling");
    const wasm = await runtime.compiler.compile(new Map(Object.entries(files)));
    session = await runtime.executor.instantiate(wasm);
    setStatus("ready");
    appendLog(`compiled ${wasm.byteLength} bytes`);
    return wasm.byteLength;
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
