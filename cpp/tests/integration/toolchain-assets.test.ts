import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";

const here = dirname(fileURLToPath(import.meta.url));
const serviceWorker = join(here, "../../public/llvm-toolchain-sw.js");
const devProxy = join(here, "../../../ui/scripts/llvmToolchainProxyMiddleware.ts");
const releaseFiles = ["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"];

describe("llvm-project toolchain assets", () => {
  test("service worker and dev proxy relay the release files, including the sysroot", () => {
    const source = readFileSync(serviceWorker, "utf8");
    const proxy = readFileSync(devProxy, "utf8");
    for (const text of [source, proxy]) {
      expect(text).toContain("https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/");
      for (const name of releaseFiles) expect(text).toContain(name);
    }
    expect(source).toContain("/llvm-toolchain-proxy");
    expect(source).toContain("application/gzip");
    expect(proxy).toContain("application/gzip");
  });
});
