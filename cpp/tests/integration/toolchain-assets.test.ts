import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const assets = join(dirname(fileURLToPath(import.meta.url)), "../../assets");
const serviceWorker = join(dirname(fileURLToPath(import.meta.url)), "../../public/llvm-toolchain-sw.js");
const devProxy = join(dirname(fileURLToPath(import.meta.url)), "../../../ui/scripts/llvmToolchainProxyMiddleware.ts");

describe("llvm-project toolchain assets", () => {
  test("sysroot archive is a gzip payload", () => {
    const header = readFileSync(join(assets, "sysroot.tgz")).subarray(0, 2);
    expect(header).toEqual(Buffer.from([0x1f, 0x8b]));
  });

  test("service worker relays the clang and lld release files", () => {
    const source = readFileSync(serviceWorker, "utf8");
    expect(source).toContain("https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/");
    for (const name of ["clang.js", "clang.wasm", "lld.js", "lld.wasm"]) {
      expect(source).toContain(name);
    }
    expect(source).toContain("/llvm-toolchain-proxy");
    const proxy = readFileSync(devProxy, "utf8");
    expect(proxy).toContain("https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/");
    for (const name of ["clang.js", "clang.wasm", "lld.js", "lld.wasm"]) {
      expect(proxy).toContain(name);
    }
  });
});
