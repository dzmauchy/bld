import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { add, assemblyAssetFiles, Block, diagram, gpio, modelAssetFiles, push } from "../../src/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const modelDir = join(coreRoot, "src/model");
const assemblyDir = join(coreRoot, "assets/assembly");

function modelSourceFiles(): string[] {
  return readdirSync(modelDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

describe("core public API", () => {
  test("add remains available", () => {
    expect(add(2, 2)).toBe(4);
  });
  test("exports compiled model APIs", () => {
    expect(Block).toBeTypeOf("function");
    expect(diagram).toBeTypeOf("function");
    expect(gpio.push.GpioInF64).toBeTypeOf("function");
    expect(push.ScopeF64).toBeTypeOf("function");
  });
  test("lists every non-test model file as an asset", () => {
    expect([...modelAssetFiles].sort()).toEqual(modelSourceFiles());
  });
  test("lists library AssemblyScript files as assets", () => {
    const names = readdirSync(assemblyDir)
      .filter((name) => name.endsWith(".ts") && name !== "harness.ts")
      .sort();
    expect([...assemblyAssetFiles].sort()).toEqual(names);
  });
  test("exposes stream helpers as static Block methods", () => {
    const source = readFileSync(join(assemblyDir, "context.ts"), "utf8");
    expect(source).toContain("static pushAll");
    expect(source).toContain("static outputCountOf");
    expect(readFileSync(join(assemblyDir, "blocks.ts"), "utf8")).not.toMatch(
      /function pushAll\(/,
    );
  });
});
