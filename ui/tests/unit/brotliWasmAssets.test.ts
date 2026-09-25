import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { expect, test } from "@rstest/core";
import { BrotliWasmAssetCompressor, workersAssetByteLimit } from "../../scripts/brotliWasmAssets.mjs";

test("oversized wasm is brotli-compressed in place and declared in Cloudflare _headers", async () => {
  const dist = join(tmpdir(), `brotli-wasm-${Date.now()}`);
  const wasmPath = join(dist, "static/wasm/d9cfc61740.module.wasm");
  const smallPath = join(dist, "static/wasm/8d92586132.module.wasm");
  await mkdir(join(dist, "static/wasm"), { recursive: true });
  const oversized = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.alloc(64, 0x11)]);
  const small = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.from("small")]);
  await writeFile(wasmPath, oversized);
  await writeFile(smallPath, small);
  await writeFile(join(dist, "_headers"), "/*\n  Cross-Origin-Opener-Policy: same-origin\n");

  const compressor = new BrotliWasmAssetCompressor(dist, 32);
  const compressed = await compressor.compress();

  expect(compressed).toEqual(["/static/wasm/d9cfc61740.module.wasm"]);
  const stored = await readFile(wasmPath);
  expect(stored.subarray(0, 4).equals(oversized.subarray(0, 4))).toBe(false);
  expect(Buffer.from(brotliDecompressSync(stored)).equals(oversized)).toBe(true);
  expect((await readFile(smallPath)).equals(small)).toBe(true);
  const headers = await readFile(join(dist, "_headers"), "utf8");
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain(compressor.headerRule("/static/wasm/d9cfc61740.module.wasm"));
  expect(headers).not.toContain("Content-Encoding:");
  expect(headers).not.toContain("/static/wasm/8d92586132.module.wasm");

  await compressor.compress();
  const again = await readFile(join(dist, "_headers"), "utf8");
  expect(again.match(/\/static\/wasm\/d9cfc61740\.module\.wasm/g)).toHaveLength(1);
});

test("Workers asset limit matches the 25 MiB static asset cap", async () => {
  expect(workersAssetByteLimit).toBe(25 * 1024 * 1024);
  const packageJson = await readFile(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8");
  expect(packageJson).toContain("node scripts/brotliWasmAssets.mjs");
});
