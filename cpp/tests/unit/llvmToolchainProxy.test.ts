import { describe, expect, test } from "@rstest/core";
import { LlvmProjectRelease } from "../../src/llvmRelease.ts";
import { LlvmToolchainProxy } from "../../src/llvmToolchainProxy.ts";

describe("llvm toolchain proxy", () => {
  test("rejects urls outside the clang and lld release assets", async () => {
    const proxy = new LlvmToolchainProxy();
    const url = new URL("http://localhost/llvm-toolchain-proxy?url=https%3A%2F%2Fexample.com%2Fclang.wasm");
    const response = await proxy.response(url);
    expect(response.status).toBe(403);
  });

  test("fetches an allowed release url", async () => {
    const release = new LlvmProjectRelease();
    const target = release.assetUrl("clang.js");
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(target);
      return new Response("glue", { status: 200 });
    }) as typeof fetch;
    try {
      const proxy = new LlvmToolchainProxy(release);
      const url = new URL(`/llvm-toolchain-proxy?url=${encodeURIComponent(target)}`, "http://localhost");
      expect(proxy.matches(url)).toBe(true);
      const response = await proxy.response(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/javascript");
      expect(await response.text()).toBe("glue");
    } finally {
      globalThis.fetch = original;
    }
  });
});
