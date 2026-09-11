import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { add, assemblyAssetFiles, Block, diagram, gpio, modelAssetFiles, push } from "./index.js";

const modelDir = join(dirname(fileURLToPath(import.meta.url)), "model");
const assemblyDir = join(dirname(fileURLToPath(import.meta.url)), "../assets/assembly");

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
});
