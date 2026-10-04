import { expect, test, type Page } from "@playwright/test";
import type { CppPageApi } from "../src/browser/api.ts";

declare global {
  interface Window {
    cpp: CppPageApi;
  }
}

test.describe.configure({ mode: "serial" });

const ADD_CPP = `
extern "C" int add(int a, int b) {
  return a + b;
}
`;

const HEADER = `extern "C" int scale(int value);`;

const SCALE_CPP = `
#include "scale.h"
extern "C" int scale(int value) {
  return value * 3;
}
`;

const CSTDINT_CPP = `
#include <cstdint>
extern "C" int32_t add32(int32_t a, int32_t b) {
  return a + b;
}
`;

const SECOND_CPP = `
extern "C" int mul(int a, int b) {
  return a * b;
}
`;

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("module-ready");
  await page.evaluate(async () => {
    await window.cpp.warmup();
  });
  await expect(page.locator("#status")).toHaveText("ready");
});

test.afterAll(async () => {
  await page.close();
});

test("compiles freestanding C++ and executes the wasm export", async () => {
  const result = await page.evaluate(async (source) => {
    return window.cpp.compileAndInvoke({ "add.cpp": source }, "add", [2, 3]);
  }, ADD_CPP);
  expect(result).toBe(5);
  expect(await page.evaluate(() => window.cpp.workerCreateCount())).toBe(2);
});

test("compiles a header plus source map without creating new workers", async () => {
  const result = await page.evaluate(async ({ header, source }) => {
    const value = await window.cpp.compileAndInvoke({ "scale.h": header, "scale.cpp": source }, "scale", [7]);
    return { value, workers: window.cpp.workerCreateCount() };
  }, { header: HEADER, source: SCALE_CPP });
  expect(result.value).toBe(21);
  expect(result.workers).toBe(2);
});

test("compiles against sysroot headers", async () => {
  const result = await page.evaluate(async (source) => {
    return window.cpp.compileAndInvoke({ "add32.cpp": source }, "add32", [40, 2]);
  }, CSTDINT_CPP);
  expect(result).toBe(42);
});

test("bare wasm uses LLVM libc, initializes C++ state once, and imports browser output and clocks", async () => {
  const output: string[] = [];
  const collectOutput = (message: import("@playwright/test").ConsoleMessage) => output.push(message.text());
  page.on("console", collectOutput);
  try {
    const result = await page.evaluate(async () => {
      const source = `
#if defined(__EMSCRIPTEN__) || defined(__wasi__)
#error Expected wasm32-unknown-unknown
#endif
#include <browser.hpp>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

int constructions = 0;
struct Startup {
  std::vector<int> values{40, 2};
  Startup() { ++constructions; }
} startup;

extern "C" int answer() {
  static std::string label = "bare wasm π";
  static std::vector<int> calls{0};
  std::printf("%s\\n", label.c_str());
  return startup.values[0] + startup.values[1] + 100 * constructions + ++calls[0];
}
extern "C" double sine(double value) { return std::sin(value); }
extern "C" double monotonic() { return browser::now(); }
extern "C" double utc() {
  return std::chrono::duration<double, std::milli>(std::chrono::system_clock::now().time_since_epoch()).count();
}
`;
      // Inspect the actual module sent to the execution worker.
      const postMessage = Worker.prototype.postMessage;
      let imports: WebAssembly.ModuleImportDescriptor[] = [];
      Worker.prototype.postMessage = function (...args: Parameters<Worker["postMessage"]>) {
        const request = args[0] as { type?: string; wasm?: Uint8Array<ArrayBuffer> };
        if (request.type === "instantiate" && request.wasm) {
          imports = WebAssembly.Module.imports(new WebAssembly.Module(request.wasm));
        }
        return Reflect.apply(postMessage, this, args);
      };
      try {
        await window.cpp.compile({ "runtime.cpp": source });
        const first = await window.cpp.invoke("answer", []);
        const second = await window.cpp.invoke("answer", []);
        const sine = await window.cpp.invoke("sine", [0.5]);
        const monotonic = await window.cpp.invoke("monotonic", []);
        const beforeUtc = Date.now();
        const utc = await window.cpp.invoke("utc", []);
        const afterUtc = Date.now();
        await window.cpp.instantiateLast();
        return { imports, first, second, sine, monotonic, beforeUtc, utc, afterUtc, restarted: await window.cpp.invoke("answer", []) };
      } finally {
        Worker.prototype.postMessage = postMessage;
      }
    });
    expect(result.imports.map(({ module, name }) => `${module}.${name}`).sort()).toEqual([
      "env.js_now", "env.js_print_char", "env.js_time",
    ]);
    expect([result.first, result.second, result.restarted]).toEqual([143, 144, 143]);
    expect(result.sine).toBeCloseTo(Math.sin(0.5));
    expect(result.monotonic).toBeGreaterThan(0);
    expect(result.utc).toBeGreaterThanOrEqual(result.beforeUtc - 1);
    expect(result.utc).toBeLessThanOrEqual(result.afterUtc + 1);
    expect(output.filter((line) => line === "bare wasm π")).toHaveLength(3);
  } finally {
    page.off("console", collectOutput);
  }
});

test("rejects unresolved dependencies at link time", async () => {
  const message = await page.evaluate(async () => {
    try {
      await window.cpp.compileOnly({
        "missing.cpp": 'extern "C" int missing_dependency(); extern "C" int answer() { return missing_dependency(); }',
      });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toMatch(/undefined symbol: missing_dependency/);
});

test("rejects an explicit host import without a registered binding", async () => {
  const message = await page.evaluate(async () => {
    try {
      await window.cpp.compile({ "unknown.cpp": `
extern "C" __attribute__((import_module("env"), import_name("unknown_host"))) int unknown_host();
extern "C" int answer() { return unknown_host(); }
` });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toBe("unsupported wasm import env.unknown_host (function)");
});

test("reuses the single clang/lld worker across different programs", async () => {
  const result = await page.evaluate(async ({ add, mul }) => {
    const sum = await window.cpp.compileAndInvoke({ "add.cpp": add }, "add", [4, 5]);
    const product = await window.cpp.compileAndInvoke({ "mul.cpp": mul }, "mul", [4, 5]);
    return { sum, product, workers: window.cpp.workerCreateCount() };
  }, { add: ADD_CPP, mul: SECOND_CPP });
  expect(result.sum).toBe(9);
  expect(result.product).toBe(20);
  expect(result.workers).toBe(2);
});

test("surfaces clang diagnostics for invalid C++", async () => {
  const message = await page.evaluate(async () => {
    try {
      await window.cpp.compile({ "bad.cpp": "not valid c++ {" });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message.length).toBeGreaterThan(0);
  expect(message).toMatch(/error:|exited with/i);
  expect(await page.evaluate(() => window.cpp.workerCreateCount())).toBe(2);
});

test("queues AST and compile requests and reuses workers after diagnostics", async () => {
  const result = await page.evaluate(async () => {
    const jobs = await Promise.allSettled([
      window.cpp.dumpAst({ "main.cpp": "int first;" }, "main.cpp"),
      window.cpp.compileOnly({ "main.cpp": "invalid c++ {" }),
      window.cpp.dumpAst({ "main.cpp": "int second;" }, "main.cpp"),
      window.cpp.compileOnly({ "main.cpp": 'extern "C" int answer() { return 42; }' }),
    ]);
    await window.cpp.instantiateLast();
    return {
      jobs: jobs.map((job) => job.status),
      asts: [jobs[0], jobs[2]].map((job) => job?.status === "fulfilled" ? job.value : undefined),
      answer: await window.cpp.invoke("answer", []),
      workers: window.cpp.workerCreateCount(),
    };
  });
  expect(result.jobs).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  expect(result.asts).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
  expect(result.answer).toBe(42);
  expect(result.workers).toBe(2);
});

test("a subsequent job cannot include a header from a previous job", async () => {
  const message = await page.evaluate(async () => {
    await window.cpp.compileOnly({ "old.h": "int old;", "main.cpp": '#include "old.h"' });
    try {
      await window.cpp.compileOnly({ "main.cpp": '#include "old.h"' });
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(message).toMatch(/old.h.*file not found/);
});

test("PCH-backed ASTs omit header declarations and changed headers rebuild correctly", async () => {
  const result = await page.evaluate(async () => {
    const header = "#pragma once\nstruct HeaderOnly { int value; };\nconstexpr int value = 41;";
    const files = { "value.hpp": header, "main.cpp": 'extern "C" int answer() { auto port = value; return port; }' };
    await window.cpp.precompileHeaders(files);
    const dump = await window.cpp.dumpAst(files, "main.cpp");
    const ast = dump.ast as { inner?: { name?: string }[] };
    const first = await window.cpp.compileAndInvoke(files, "answer", []);
    const second = await window.cpp.compileAndInvoke({ ...files, "value.hpp": header.replace("41", "42") }, "answer", []);
    const third = await window.cpp.compileAndInvoke({ "main.cpp": 'extern "C" int answer() { return 43; }' }, "answer", []);
    return { ok: dump.ok, ast: JSON.stringify(dump.ast), names: ast.inner?.map((node) => node.name), first, second, third };
  });
  expect(result.ok).toBe(true);
  expect(result.ast).toContain('"name":"answer"');
  expect(result.names).not.toContain("HeaderOnly");
  expect(result.names).not.toContain("value");
  expect([result.first, result.second, result.third]).toEqual([41, 42, 43]);
});

test("links multiple nested translation units across fresh clang instances", async () => {
  const result = await page.evaluate(async () => {
    const files = {
      "shared/value.hpp": "#pragma once\n#include <cstdint>\nconstexpr int32_t value = 40;\nint helper();",
      "shared/helper.cpp": '#include "shared/value.hpp"\nint helper() { return value; }',
      "main.cpp": '#include "shared/value.hpp"\nextern "C" int answer() { return helper() + 2; }',
    };
    await window.cpp.precompileHeaders(files);
    const first = await window.cpp.compileAndInvoke(files, "answer", []);
    const second = await window.cpp.compileAndInvoke({
      ...files,
      "shared/value.hpp": files["shared/value.hpp"].replace("40", "41"),
    }, "answer", []);
    return { first, second, workers: window.cpp.workerCreateCount() };
  });
  expect(result).toEqual({ first: 42, second: 43, workers: 2 });
});

test("running the last compiled program again starts with fresh wasm state", async () => {
  const result = await page.evaluate(async () => {
    await window.cpp.compile({ "counter.cpp": 'int count = 0;\nextern "C" int bump() { return ++count; }' });
    const first = await window.cpp.invoke("bump", []);
    const second = await window.cpp.invoke("bump", []);
    await window.cpp.instantiateLast();
    return { first, second, restarted: await window.cpp.invoke("bump", []) };
  });
  expect(result).toEqual({ first: 1, second: 2, restarted: 1 });
});
