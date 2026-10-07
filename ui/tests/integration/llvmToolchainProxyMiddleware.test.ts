import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { expect, test } from "@rstest/core";
import { attachLlvmToolchainProxy, LlvmToolchainAssetCache } from "../../scripts/llvmToolchainProxyMiddleware.ts";

const prefix = "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/";
const noDelay = async () => {};

class ProxyTestServer {
  private readonly server: Server;

  constructor(assets: LlvmToolchainAssetCache, onRequest = () => {}) {
    let middleware: (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void;
    attachLlvmToolchainProxy({ use: (handler) => { middleware = handler; } }, assets);
    this.server = createServer((request, response) => {
      onRequest();
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end("not a proxy request");
      });
    });
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("server has no TCP address");
    return `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }
}

test("parallel workers share a sysroot download, retry a transient failure, and reuse the successful bytes", async () => {
  let requests = 0;
  const gate = Promise.withResolvers<void>();
  const assets = new LlvmToolchainAssetCache(async (url) => {
    expect(url).toBe(`${prefix}sysroot.tgz`);
    requests++;
    await gate.promise;
    return requests === 1 ? new Response("temporary failure", { status: 500 }) : new Response(new Uint8Array([31, 139, 0, 255]));
  }, noDelay);
  let arrivals = 0;
  const server = new ProxyTestServer(assets, () => {
    if (++arrivals === 4) gate.resolve();
  });
  const base = await server.start();
  const url = `${base}/llvm-toolchain-proxy?url=${encodeURIComponent(`${prefix}sysroot.tgz`)}`;
  try {
    const responses = Promise.all(Array.from({ length: 4 }, () => fetch(url)));
    for (const response of await responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/gzip");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([31, 139, 0, 255]));
    }
    expect(await (await fetch(url)).arrayBuffer()).toEqual(new Uint8Array([31, 139, 0, 255]).buffer);
    expect(requests).toBe(2);
  } finally {
    await server.close();
  }
});

test("retries connection failures and interrupted response bodies", async () => {
  let requests = 0;
  const assets = new LlvmToolchainAssetCache(async () => {
    if (++requests === 1) throw new TypeError("fetch failed");
    if (requests === 2) return new Response(new ReadableStream({
      start(controller) { controller.error(new Error("connection closed while reading")); },
    }));
    return new Response("complete archive");
  }, noDelay);
  expect((await assets.get("sysroot.tgz")).body.toString()).toBe("complete archive");
  expect(requests).toBe(3);
});

test.each([408, 429, 502, 503, 504])("retries a transient HTTP %s response", async (status) => {
  let requests = 0;
  const assets = new LlvmToolchainAssetCache(async () => ++requests === 1
    ? new Response("temporary failure", { status }) : new Response("archive"), noDelay);
  expect((await assets.get("sysroot.tgz")).status).toBe(200);
  expect(requests).toBe(2);
});

test.each([404, 503])("does not retain an HTTP %s failure in either cache", async (status) => {
  let requests = 0;
  let available = false;
  const assets = new LlvmToolchainAssetCache(async () => {
    requests++;
    return available ? new Response("archive") : new Response("unavailable", { status });
  }, noDelay);
  const server = new ProxyTestServer(assets);
  const base = await server.start();
  const url = `${base}/llvm-toolchain-proxy?url=${encodeURIComponent(`${prefix}sysroot.tgz`)}`;
  try {
    const failed = await fetch(url);
    expect(failed.status).toBe(status);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    await failed.text();
    expect(requests).toBe(status === 404 ? 1 : 3);
    available = true;
    expect(await (await fetch(url)).text()).toBe("archive");
    expect(requests).toBe(status === 404 ? 2 : 4);
  } finally {
    await server.close();
  }
});

test("reports exhausted connection failures and allows the next request to try again", async () => {
  let requests = 0;
  const assets = new LlvmToolchainAssetCache(async () => {
    if (++requests <= 3) throw new TypeError("fetch failed");
    return new Response("archive");
  }, noDelay);
  const server = new ProxyTestServer(assets);
  const base = await server.start();
  const url = `${base}/llvm-toolchain-proxy?url=${encodeURIComponent(`${prefix}sysroot.tgz`)}`;
  try {
    const failed = await fetch(url);
    expect(failed.status).toBe(502);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(await failed.text()).toContain("failed to download sysroot.tgz after 3 attempts: fetch failed");
    expect(await (await fetch(url)).text()).toBe("archive");
    expect(requests).toBe(4);
  } finally {
    await server.close();
  }
});

test("forbidden and unrelated requests never download upstream assets", async () => {
  let requests = 0;
  const server = new ProxyTestServer(new LlvmToolchainAssetCache(async () => {
    requests++;
    return new Response("unexpected download");
  }, noDelay));
  const base = await server.start();
  try {
    const forbidden = await fetch(`${base}/llvm-toolchain-proxy?url=https://example.com/sysroot.tgz`);
    expect(forbidden.status).toBe(403);
    await forbidden.text();
    const unrelated = await fetch(`${base}/other`);
    expect(unrelated.status).toBe(404);
    await unrelated.text();
    expect(requests).toBe(0);
  } finally {
    await server.close();
  }
});
