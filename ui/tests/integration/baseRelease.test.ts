import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { packTar } from "modern-tar";
import { expect, test } from "@rstest/core";
import { isCurrentBaseRelease } from "../../scripts/fetch-base-release.mjs";

test("the bundled base release exposes callable factories", async () => {
  const bytes = await readFile(new URL("../../public/base-0.1.0.tar.gz", import.meta.url));
  expect(await isCurrentBaseRelease(bytes)).toBe(true);
});

test("asset validation rejects the former class release under the same version", async () => {
  const encoder = new TextEncoder();
  const files = {
    "meta.json": JSON.stringify({ namespaces: [], blocks: [{ id: "ScopeF32", parameters: [] }] }),
    "./base/f32_blocks.hpp": "using ScopeF32 = Scope<float>;",
  };
  const tar = await packTar(Object.entries(files).map(([name, text]) => {
    const body = encoder.encode(text);
    return { header: { name, size: body.length }, body };
  }));
  expect(await isCurrentBaseRelease(gzipSync(tar))).toBe(false);
  expect(await isCurrentBaseRelease(new Uint8Array())).toBe(false);
});
