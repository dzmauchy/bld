import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";
import { ToolchainServiceWorkerAsset } from "../../../ui/scripts/vitePlugins.ts";

interface FetchProbe {
  request: { url: string };
  respondWith(response: Promise<Response>): void;
}

test("the generated service worker relays every asset from the configured release", async () => {
  const release = new LlvmProjectRelease();
  const listeners = new Map<string, (event: FetchProbe) => void>();
  const requests: string[] = [];
  runInNewContext(await new ToolchainServiceWorkerAsset().source(), {
    self: {
      location: { origin: "https://bld.example" },
      addEventListener: (name: string, listener: (event: FetchProbe) => void) => listeners.set(name, listener),
    },
    URL, Response,
    fetch: async (url: string) => {
      requests.push(url);
      return new Response("release asset");
    },
  });
  const dispatch = (url: string) => {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({ request: { url }, respondWith: (value) => { response = value; } });
    return response;
  };
  for (const name of LlvmProjectRelease.files) {
    const pending = dispatch(release.assetUrl(name));
    expect(pending, name).toBeDefined();
    const response = await pending!;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(release.contentType(name));
    expect(await response.text()).toBe("release asset");
    const relay = new URL(requests.at(-1)!);
    expect(relay.origin).toBe("https://bld.example");
    expect(relay.pathname).toBe("/llvm-toolchain-proxy");
    expect(relay.searchParams.get("url")).toBe(release.assetUrl(name));
  }
  expect(dispatch("https://example.com/clang.wasm")).toBeUndefined();
  expect(dispatch(release.assetUrl("unlisted.wasm"))).toBeUndefined();
  expect(requests).toHaveLength(LlvmProjectRelease.files.length);
});
