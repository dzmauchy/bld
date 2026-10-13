import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll } from "vitest";
import { build } from "vite";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";
import { baseURL, browserTest, expect, type Page } from "../../tests/e2e/browser.ts";
import { packTar } from "../../tests/tarFixture.ts";
import type { FilesystemTrial, FilesystemResult } from "./fixtures/filesystem.worker.ts";

const test = browserTest();
let workerCode: string;
const longPath = `/sysroot/include/${"nested/".repeat(20)}long.hpp`;
const contents = 'namespace test { const char* label = "µ"; }\n';

beforeAll(async () => {
  // Bundle this test-only worker without adding a testing API to the application.
  const built = await build({
    configFile: false, logLevel: "silent",
    build: { write: false, minify: false, target: "esnext", lib: {
      entry: fileURLToPath(new URL("./fixtures/filesystem.worker.ts", import.meta.url)), formats: ["es"],
    } },
  });
  const outputs = Array.isArray(built) ? built : [built];
  const chunk = outputs.flatMap(output => "output" in output ? output.output : [])
    .find(output => output.type === "chunk" && output.isEntry);
  if (!chunk || chunk.type !== "chunk") throw new Error("Filesystem worker was not bundled");
  workerCode = chunk.code;
});

async function install(page: Page, archives: FilesystemTrial["archives"], paths: string[], shared = false,
  excluded = ["/sysroot/include/link.h"]): Promise<FilesystemResult> {
  await page.goto(baseURL());
  const release = new LlvmProjectRelease();
  const proxy = (file: string) => `${baseURL()}/llvm-toolchain-proxy?url=${encodeURIComponent(release.assetUrl(file))}`;
  const trial: FilesystemTrial = { scriptUrl: proxy("clang.js"), wasmUrl: proxy("clang.wasm"), archives, paths, excluded, shared };
  const result = await page.evaluate(async ({ code, trial }) => {
    // Puppeteer arguments use JSON serialization; restore typed byte arrays.
    trial.archives = trial.archives.map(archive => ({ ...archive, bytes: new Uint8Array(Object.values(archive.bytes)) }));
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    const worker = new Worker(url, { type: "module" });
    try {
      return await new Promise<FilesystemResult>((resolve, reject) => {
        worker.onmessage = event => resolve(event.data as FilesystemResult);
        worker.onerror = event => reject(new Error(event.message));
        worker.postMessage(trial);
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }, { code: workerCode, trial });
  expect(result.error).toBeUndefined();
  return result;
}

for (const format of ["ustar", "gnu", "pax"]) {
  test(`installs ${format} gzip archives through the actual Emscripten FS API`, async ({ page }) => {
    const bytes = new Uint8Array(await readFile(new URL(`../tests/fixtures/tar/${format}.tgz`, import.meta.url)));
    const paths = ["/sysroot/include/empty.h", longPath, "/sysroot/lib/libtest.a"];
    if (format === "pax") paths.push("/sysroot/include/測定.hpp");
    const result = await install(page, [{ bytes, compressed: true }], paths);
    expect(result.installed).toEqual([format === "pax" ? 4 : 3]);
    expect(Object.values(result.files[paths[0]!]!)).toHaveLength(0);
    expect(new TextDecoder().decode(new Uint8Array(Object.values(result.files[longPath]!)))).toBe(contents);
    expect(Object.values(result.files[paths[2]!]!)).toEqual([0, 128, 255, 66]);
    expect(result.excluded).toEqual({ "/sysroot/include/link.h": false });
    expect(result.missingParentRejected).toBe(true);
    if (format === "pax") expect(new TextDecoder().decode(new Uint8Array(Object.values(result.files[paths[3]!]!)))).toBe(contents);
  });
}

test("PROXYFS preserves installed sysroot files across actual Emscripten instances", async ({ page }) => {
  const bytes = new Uint8Array(await readFile(new URL("../tests/fixtures/tar/ustar.tgz", import.meta.url)));
  const result = await install(page, [{ bytes, compressed: true }], [longPath, "/sysroot/lib/libtest.a"], true);
  expect(result.freshRuntime).toBe(true);
  expect(new TextDecoder().decode(new Uint8Array(Object.values(result.files[longPath]!)))).toBe(contents);
  expect(Object.values(result.files["/sysroot/lib/libtest.a"]!)).toEqual([0, 128, 255, 66]);
});

test("direct FS installation supports raw tar and excludes non-sysroot and unsafe entries", async ({ page }) => {
  const bytes = packTar([
    { header: { name: "sysroot/include/ok.h", size: 5 }, body: "hello" },
    { header: { name: "sysroot/../escape.a", size: 1 }, body: "x" },
    { header: { name: "other/include/test.h", size: 1 }, body: "x" },
    { header: { name: "sysroot/share/license.txt", size: 1 }, body: "x" },
  ]);
  const excluded = ["/escape.a", "/other/include/test.h", "/sysroot/share/license.txt"];
  const result = await install(page, [{ bytes, compressed: false }], ["/sysroot/include/ok.h"], false, excluded);
  expect(result.installed).toEqual([1]);
  expect(new TextDecoder().decode(new Uint8Array(Object.values(result.files["/sysroot/include/ok.h"]!)))).toBe("hello");
  expect(Object.values(result.excluded)).toEqual([false, false, false]);
});
