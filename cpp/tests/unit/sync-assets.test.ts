import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LlvmProjectRelease } from "../../src/llvmRelease.ts";
import { LlvmProjectReleaseAssets } from "../../scripts/sync-assets.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("llvm-project release asset sync", () => {
  test("points clang and lld js and wasm at the llvm-project release", () => {
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
    expect(release.isToolchainAsset(release.assetUrl("clang.wasm"))).toBe(true);
    expect(release.isToolchainAsset("https://example.com/clang.wasm")).toBe(false);
  });

  test("syncs only the sysroot archive into the repo", () => {
    expect([...LlvmProjectReleaseAssets.files]).toEqual(["sysroot.tgz"]);
    const client = new LlvmProjectReleaseAssets("/tmp");
    expect(client.assetUrl("sysroot.tgz")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/sysroot.tgz",
    );
  });

  test("does not keep vendored clang or lld js and wasm", () => {
    const assets = join(here, "../../assets");
    for (const name of ["clang.js", "clang.wasm", "lld.js", "lld.wasm"]) {
      expect(existsSync(join(assets, name)), name).toBe(false);
    }
  });

  test("does not keep the in-repo clang-builder workflow or script", () => {
    const repoRoot = join(here, "../../..");
    expect(existsSync(join(repoRoot, ".github/workflows/clang-builder.yml"))).toBe(false);
    expect(existsSync(join(repoRoot, ".github/scripts/clang-builder.mjs"))).toBe(false);
  });
});
