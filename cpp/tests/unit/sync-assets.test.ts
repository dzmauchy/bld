import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import { LlvmProjectRelease } from "../../src/llvmRelease.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("llvm-project release assets", () => {
  test("points clang, lld, and the sysroot at the llvm-project release", () => {
    const release = new LlvmProjectRelease();
    expect(release.releasePageUrl()).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/tag/clang-lld-wasm-latest",
    );
    expect(release.assetUrl("clang.wasm")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/clang.wasm",
    );
    expect(release.assetUrl("clang.js")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/clang.js",
    );
    expect(release.assetUrl("lld.wasm")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/lld.wasm",
    );
    expect(release.assetUrl("lld.js")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/lld.js",
    );
    expect(release.assetUrl("sysroot.tgz")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/sysroot.tgz",
    );
    expect(release.contentType("sysroot.tgz")).toBe("application/gzip");
    expect(release.isToolchainAsset(release.assetUrl("sysroot.tgz"))).toBe(true);
    expect(release.isToolchainAsset("https://example.com/clang.wasm")).toBe(false);
  });

  test("does not keep vendored clang, lld, or sysroot files", () => {
    const assets = join(here, "../../assets");
    for (const name of ["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"]) {
      expect(existsSync(join(assets, name)), name).toBe(false);
    }
    const repoRoot = join(here, "../../..");
    expect(existsSync(join(repoRoot, "cpp/scripts/sync-assets.mjs"))).toBe(false);
    expect(existsSync(join(repoRoot, ".github/workflows/clang-builder.yml"))).toBe(false);
    expect(existsSync(join(repoRoot, ".github/scripts/clang-builder.mjs"))).toBe(false);
  });
});
