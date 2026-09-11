import { brotliCompressSync } from "node:zlib";
import { expect, test } from "@rstest/core";
import { PrecompressedWasmDelivery } from "../../src/deploy/precompressedWasmDelivery.ts";

const wasm = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test("raw wasm is left for the browser to compile", () => {
  const delivery = new PrecompressedWasmDelivery();
  expect(delivery.isWasmModule(wasm)).toBe(true);
  expect(delivery.shouldServeAsBrotli("/static/js/clang.wasm", 200, wasm)).toBe(false);
  expect(delivery.shouldServeAsBrotli("/index.html", 200, wasm)).toBe(false);
  expect(delivery.shouldServeAsBrotli("/missing.wasm", 404, wasm)).toBe(false);
});

test("brotli bytes are served with a single manual content encoding", () => {
  const delivery = new PrecompressedWasmDelivery();
  const compressed = brotliCompressSync(wasm);
  expect(delivery.isWasmModule(compressed)).toBe(false);
  expect(delivery.shouldServeAsBrotli("/static/js/clang.wasm", 200, compressed)).toBe(true);
  expect(delivery.shouldServeAsBrotli("/index.html", 200, Uint8Array.from([0x3c, 0x21, 0x44, 0x4f]))).toBe(false);

  const headers = delivery.brotliHeaders(new Headers({ "Cross-Origin-Embedder-Policy": "require-corp" }));
  expect(headers.get("Content-Encoding")).toBe("br");
  expect(headers.get("Content-Type")).toBe("application/wasm");
  expect(headers.get("Cache-Control")).toContain("no-transform");
  expect(headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
});

test("prefix split keeps the original stream bytes", async () => {
  const delivery = new PrecompressedWasmDelivery();
  const compressed = new Uint8Array(brotliCompressSync(wasm));
  const stream = new Blob([compressed]).stream() as unknown as ReadableStream<Uint8Array>;
  const split = await delivery.splitPrefix(stream);
  expect(delivery.shouldServeAsBrotli("/clang.wasm", 200, split.prefix)).toBe(true);
  const rest = new Uint8Array(await new Response(split.stream).arrayBuffer());
  expect(rest).toEqual(compressed);
});
