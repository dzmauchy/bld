import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { LlvmProjectReleaseAssets } from "../../scripts/sync-assets.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("llvm-project release asset sync", () => {
  test("points at the llvm-project GitHub release for wasm and js glue", () => {
    expect(LlvmProjectReleaseAssets.owner).toBe("dzmauchy");
    expect(LlvmProjectReleaseAssets.repo).toBe("llvm-project");
    expect(LlvmProjectReleaseAssets.tag).toBe(
      "clang-lld-wasm-latest",
    );
    expect([...LlvmProjectReleaseAssets.files]).toEqual([
      "clang.js",
      "clang.wasm",
      "lld.js",
      "lld.wasm",
      "sysroot.tgz",
    ]);

    const client = new LlvmProjectReleaseAssets("/tmp");
    expect(client.releasePageUrl).toBe("https://github.com/dzmauchy/llvm-project/releases");
    expect(client.assetUrl("clang.wasm")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/clang.wasm",
    );
    expect(client.assetUrl("lld.js")).toBe(
      "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/lld.js",
    );
  });

  test("does not keep the in-repo clang-builder workflow or script", () => {
    const repoRoot = join(here, "../../..");
    expect(existsSync(join(repoRoot, ".github/workflows/clang-builder.yml"))).toBe(false);
    expect(existsSync(join(repoRoot, ".github/scripts/clang-builder.mjs"))).toBe(false);
  });
});
