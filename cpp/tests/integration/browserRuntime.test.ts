import { expect, test } from "@rstest/core";
import { BrowserCppRuntime } from "../../src/browser/api.ts";
import { BrowserClangAstDumper } from "../../src/browserClangAstDumper.ts";

/** Browser transport stand-in; the runtime, AST client, and RPC lifecycle are real. */
class RecordingWorker extends EventTarget {
  static readonly instances: RecordingWorker[] = [];
  terminated = false;
  readonly requests: string[] = [];

  constructor() {
    super();
    RecordingWorker.instances.push(this);
  }

  postMessage(data: { id: number; type: string }): void {
    this.requests.push(data.type);
    queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
      data: { id: data.id, type: "ok", result: 0, ast: { kind: "TranslationUnitDecl" } },
    })));
  }

  terminate(): void {
    this.terminated = true;
  }
}

test("AST clients share the compiler runtime and can reuse the shared API after shutdown", async () => {
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: RecordingWorker });
  let runtime = BrowserCppRuntime.shared();
  try {
    const dumper = BrowserClangAstDumper.shared();
    const files = new Map([["main.cpp", "int value;"]]);
    await dumper.dumpAsync(files, "main.cpp");
    expect(runtime.workerCreateCount).toBe(1);
    expect(BrowserCppRuntime.shared()).toBe(runtime);
    await Promise.all([runtime.warmup(), runtime.warmup()]);
    await dumper.dumpAsync(files, "main.cpp");
    expect(runtime.workerCreateCount).toBe(2);
    expect(RecordingWorker.instances).toHaveLength(2);
    expect(RecordingWorker.instances[0]?.requests).toEqual(["init", "precompile-headers", "dump-ast", "precompile-headers", "dump-ast"]);

    await runtime.close();
    expect(RecordingWorker.instances.every((worker) => worker.terminated)).toBe(true);
    expect(() => runtime.compiler).toThrow("C++ runtime is closed");
    const closed = runtime;
    runtime = BrowserCppRuntime.shared();
    expect(runtime).not.toBe(closed);
    await dumper.dumpAsync(files, "main.cpp");
    expect(runtime.workerCreateCount).toBe(1);
    expect(RecordingWorker.instances).toHaveLength(3);
    expect(RecordingWorker.instances[2]?.requests).toEqual(["init", "precompile-headers", "dump-ast"]);
  } finally {
    await runtime.close();
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
  }
});
