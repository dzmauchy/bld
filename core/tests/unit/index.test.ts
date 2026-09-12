import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  add,
  BlockDefinition,
  CompilationModel,
  Connection,
  Diagram,
  DiagramBlock,
  DiagramCompiler,
  Library,
  modelAssetFiles,
  Palette,
  PortEndpoint,
  TypeSystem,
} from "../../src/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const modelDir = join(coreRoot, "src/model");

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
    expect(Diagram).toBeTypeOf("function");
    expect(Palette).toBeTypeOf("function");
    expect(DiagramBlock).toBeTypeOf("function");
    expect(Connection).toBeTypeOf("function");
    expect(PortEndpoint).toBeTypeOf("function");
    expect(BlockDefinition).toBeTypeOf("function");
    expect(TypeSystem).toBeTypeOf("function");
    expect(DiagramCompiler).toBeTypeOf("function");
    expect(CompilationModel).toBeTypeOf("function");
    expect(Library).toBeTypeOf("function");
  });
  test("lists every non-test model file as an asset", () => {
    expect([...modelAssetFiles].sort()).toEqual(modelSourceFiles());
  });
});
