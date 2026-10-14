import { Worker } from "node:worker_threads";
import { build } from "vite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { WorkerCppWasmCompiler } from "cpp/compiler.ts";
import type { CompilationPhaseEvent } from "cpp/compilationProgress.ts";
import { TestToolchain } from "../toolchain.ts";

const assets = new TestToolchain();
let workerUrl: URL;
let compiler: WorkerCppWasmCompiler;
beforeAll(async () => {
  await assets.open();
  const output = await build({
    configFile: false, logLevel: "silent",
    build: {
      write: false, minify: false, target: "esnext",
      lib: { entry: new URL("../fixtures/compiler.node.ts", import.meta.url).pathname, formats: ["es"] },
      rollupOptions: { external: ["node:worker_threads"] },
    },
  });
  const outputs = Array.isArray(output) ? output : [output];
  const chunk = outputs.flatMap(item => "output" in item ? item.output : [])
    .find(item => item.type === "chunk" && item.isEntry);
  if (!chunk || chunk.type !== "chunk") throw new Error("Missing Node worker bundle");
  workerUrl = new URL(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
}, 120_000);
beforeEach(() => {
  const worker = new Worker(workerUrl, { workerData: { assetBase: new URL(assets.assetUrl("clang.js")).origin } });
  compiler = new WorkerCppWasmCompiler({
    postMessage: (data, transfer) => worker.postMessage(data, transfer as ArrayBuffer[] | undefined),
    onMessage: handler => { worker.on("message", handler); },
    onError: handler => { worker.on("error", handler); },
    terminate: () => worker.terminate(),
  });
});
afterEach(async () => { await compiler.close(); });
afterAll(async () => { await assets.close(); });

const source = (value: number) => new Map([["main.cpp", `extern "C" int answer() { return ${value}; }`]]);
const answer = async (wasm: Uint8Array) => ((await TestToolchain.execute(wasm)).answer as () => number)();

describe("real Node compiler worker", () => {
  test("shares preparation across overlapping AST and compile requests, then reuses the worker", async () => {
    const preparation = compiler.warmup();
    expect(compiler.warmup()).toBe(preparation);
    const ast = compiler.dumpAst(source(42), "main.cpp");
    const wasm = compiler.compile(source(42));
    await preparation;
    expect((await ast).ok).toBe(true);
    expect(await answer(await wasm)).toBe(42);
    expect(compiler.warmup()).toBe(preparation);
    expect(await answer(await compiler.compile(source(43)))).toBe(43);
    expect(assets.requests.filter(name => name === "sysroot.tgz")).toHaveLength(1);
  });

  test("serializes conflicting jobs and routes progress and owned output bytes to each caller", async () => {
    const firstEvents: CompilationPhaseEvent[] = [];
    const secondEvents: CompilationPhaseEvent[] = [];
    const first = compiler.compile(source(40), event => firstEvents.push(event));
    const second = compiler.compile(source(42), event => secondEvents.push(event));
    const [firstWasm, secondWasm] = await Promise.all([first, second]);
    expect(await answer(firstWasm)).toBe(40);
    expect(await answer(secondWasm)).toBe(42);
    expect(firstEvents).toEqual([
      { phase: "awaiting-modules", status: "active" }, { phase: "awaiting-modules", status: "completed" },
      { phase: "compilation", status: "active" }, { phase: "compilation", status: "completed" },
      { phase: "linking", status: "active" }, { phase: "linking", status: "completed" },
    ]);
    expect(secondEvents).toEqual(firstEvents);
    // A subsequent result transfer leaves the worker's persisted object usable.
    expect(await answer(await compiler.compile(source(42)))).toBe(42);
    expect(await answer(firstWasm)).toBe(40);
  });

  test("keeps a queued successful job usable after a native compiler error", async () => {
    const failure = expect(compiler.compile(new Map([["main.cpp", "#error invalid source"]]))).rejects.toThrow("invalid source");
    const next = compiler.compile(source(44));
    await failure;
    expect(await answer(await next)).toBe(44);
  });

  test("retries a failed download on the same worker", async () => {
    assets.failNext("clang.js");
    await expect(compiler.warmup()).rejects.toThrow(/clang.js: 503/);
    await Promise.all([compiler.warmup(), compiler.warmup()]);
    expect(await answer(await compiler.compile(source(45)))).toBe(45);
  });

  test("closing rejects pending and future requests", async () => {
    const pending = expect(compiler.compile(source(46))).rejects.toThrow("worker is closed");
    await compiler.close();
    await pending;
    await expect(compiler.warmup()).rejects.toThrow("worker is closed");
  });
});
