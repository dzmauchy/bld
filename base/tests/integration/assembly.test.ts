import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BlockRegistry, installAssemblySource, installLibrary } from "runtime";
import { compileBrowserProgram } from "runtime/compile.ts";
import { install } from "base";
import { instantiateWasm } from "runtime/run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const assemblyPath = join(here, "../../dist/assembly.js");
const catalog = JSON.parse(readFileSync(join(here, "../../../core/assets/blocks.json"), "utf8")) as Record<
  string,
  unknown
>;
const blockIds = Object.keys(catalog).filter((key) => key !== "$schema");

describe("base library assembly", () => {
  test("installs an implementation for every blocks.json entry", () => {
    const registry = installLibrary(install, new BlockRegistry());
    for (const id of blockIds) {
      expect(registry.has(id), id).toBe(true);
    }
  });

  test("bundled assembly is a single optimized ESM file without Binaryen", () => {
    const source = readFileSync(assemblyPath, "utf8");
    expect(source).toContain("export");
    expect(source).toMatch(/install/);
    expect(source).not.toContain("binaryen");
    expect(source.trim().split("\n")).toHaveLength(1);
  });

  test("bundled assembly can be loaded by the runtime", async () => {
    const source = readFileSync(assemblyPath, "utf8");
    const registry = new BlockRegistry();
    await installAssemblySource(source, registry);
    expect(registry.has("const_f32")).toBe(true);
    expect(registry.has("scope_f32")).toBe(true);

    const wasm = compileBrowserProgram(
      {
        blocks: [
          { id: 0, ref: "scope_f32", conf: { precision: 10 }, consumers: [], receiveChannels: 1 },
          {
            id: 1,
            ref: "const_f32",
            conf: { v: 2.25 },
            consumers: [{ blockId: 0, channel: 0 }],
            receiveChannels: 1,
          },
        ],
      },
      { registry },
    );
    const instance = await instantiateWasm(wasm);
    (instance.exports.tickThenObserve as () => void)();
    const lastPin = instance.exports.lastPin as (blockId: number, pin: number) => number;
    expect(lastPin(0, 0)).toBe(2.25);
  });
});
