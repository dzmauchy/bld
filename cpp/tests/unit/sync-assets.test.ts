import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import { LlvmProjectRelease } from "../../src/llvmRelease.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("clang-wasm release assets", () => {
  test("points clang, lld, and the sysroot at the clang-wasm release", () => {
    const release = new LlvmProjectRelease();
    expect(release.releasePageUrl()).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/tag/clang-23.1.2",
    );
    expect(release.assetUrl("clang.wasm")).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/clang.wasm",
    );
    expect(release.assetUrl("clang.js")).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/clang.js",
    );
    expect(release.assetUrl("lld.wasm")).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/lld.wasm",
    );
    expect(release.assetUrl("lld.js")).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/lld.js",
    );
    expect(release.assetUrl("sysroot.tgz")).toBe(
      "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/sysroot.tgz",
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
