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

const HOST_CPP = `
extern "C" int host_add(int a, int b);
extern "C" int call_host(int a, int b) {
  return host_add(a, b);
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
  expect(await page.evaluate(() => window.cpp.workerCreateCount())).toBe(3);
});

test("compiles a header plus source map without creating new workers", async () => {
  const result = await page.evaluate(async ({ header, source }) => {
    const value = await window.cpp.compileAndInvoke({ "scale.h": header, "scale.cpp": source }, "scale", [7]);
    return { value, workers: window.cpp.workerCreateCount() };
  }, { header: HEADER, source: SCALE_CPP });
  expect(result.value).toBe(21);
  expect(result.workers).toBe(3);
});

test("compiles against sysroot headers", async () => {
  const result = await page.evaluate(async (source) => {
    return window.cpp.compileAndInvoke({ "add32.cpp": source }, "add32", [40, 2]);
  }, CSTDINT_CPP);
  expect(result).toBe(42);
});

test("executes wasm with host env bindings", async () => {
  const result = await page.evaluate(async (source) => {
    return window.cpp.compileAndInvoke({ "host.cpp": source }, "call_host", [10, 32]);
  }, HOST_CPP);
  expect(result).toBe(42);
});

test("reuses clang and lld workers across different programs", async () => {
  const result = await page.evaluate(async ({ add, mul }) => {
    const sum = await window.cpp.compileAndInvoke({ "add.cpp": add }, "add", [4, 5]);
    const product = await window.cpp.compileAndInvoke({ "mul.cpp": mul }, "mul", [4, 5]);
    return { sum, product, workers: window.cpp.workerCreateCount() };
  }, { add: ADD_CPP, mul: SECOND_CPP });
  expect(result.sum).toBe(9);
  expect(result.product).toBe(20);
  expect(result.workers).toBe(3);
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
  expect(await page.evaluate(() => window.cpp.workerCreateCount())).toBe(3);
});
