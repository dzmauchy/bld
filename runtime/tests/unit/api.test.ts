import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BlockRegistry,
  importAssembly,
  installAssembly,
  installLibraryFromUrl,
  registerAssemblyUrl,
  resolveAssemblyUrl,
} from "runtime";

describe("library ES module loading", () => {
  test("importAssembly dynamically imports an ES module from a file URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bld-assembly-"));
    const file = join(dir, "lib.js");
    writeFileSync(
      file,
      `export function install(api) { api.define("from_file", { emit() {} }); }\n`,
    );
    const registry = new BlockRegistry();
    await installAssembly(pathToFileURL(file).href, registry);
    expect(registry.has("from_file")).toBe(true);
  });

  test("installLibraryFromUrl imports assembly by URL instead of fetching JS text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bld-lib-"));
    const assemblyFile = join(dir, "assembly.js");
    writeFileSync(
      assemblyFile,
      `export function install(api) { api.define("from_url", { emit() {} }); }\n`,
    );
    const assemblyUrl = pathToFileURL(assemblyFile).href;
    const fetched: string[] = [];
    const imported: string[] = [];
    const registry = new BlockRegistry();
    await installLibraryFromUrl("https://libs.example/base.json", {
      registry,
      fetchText: async (url) => {
        fetched.push(url);
        return JSON.stringify({ id: "base", name: "Base", assembly: "assembly.js" });
      },
      importModule: async (url) => {
        imported.push(url);
        expect(url).toBe("https://libs.example/assembly.js");
        return importAssembly(assemblyUrl);
      },
    });
    expect(fetched).toEqual(["https://libs.example/base.json"]);
    expect(imported).toEqual(["https://libs.example/assembly.js"]);
    expect(registry.has("from_url")).toBe(true);
  });

  test("registerAssemblyUrl maps relative names to import specifiers", () => {
    registerAssemblyUrl("demo-assembly.js", "file:///tmp/demo-assembly.js");
    expect(resolveAssemblyUrl("demo-assembly.js")).toBe("file:///tmp/demo-assembly.js");
    expect(resolveAssemblyUrl("https://cdn.example/demo-assembly.js")).toBe(
      "https://cdn.example/demo-assembly.js",
    );
  });
});
