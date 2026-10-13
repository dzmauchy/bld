import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { LibraryArchive } from "core/model/libraryArchive.ts";
import { LlvmToolchainProxy, baseLibraryPath, baseLibraryUrl } from "cpp/llvmToolchainProxy.ts";

test("the production relay loads the base library on demand without a bundled archive", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../../core/assets/base.json", import.meta.url), "utf8"));
  expect(baseLibraryUrl).toBe(manifest.location);
  const proxy = new LlvmToolchainProxy();
  const request = new URL(baseLibraryPath, "https://bld.example");
  expect(proxy.matches(request)).toBe(true);
  const response = await proxy.response(request);
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type")).toBe("application/gzip");
  const archive = await LibraryArchive.fromTarGz(await response.arrayBuffer());
  expect(archive.files()["base/f32_blocks.hpp"]).toContain("ScopeF32");
  expect(archive.files()["core/diagram.hpp"]).toBeDefined();
  expect(archive.metadata).toMatchObject({ blocks: expect.any(Array), namespaces: expect.any(Array) });
});
