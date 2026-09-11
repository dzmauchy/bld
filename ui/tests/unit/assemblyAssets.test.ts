import { expect, test } from "vitest";
import { assemblyAssetFiles } from "core";
import { assemblyAssets } from "../../src/assemblyAssets.ts";
import { createBrowserAsRuntime } from "../../src/as/runtime.ts";

test("loads every core AssemblyScript library file as a source asset", () => {
  expect(Object.keys(assemblyAssets).sort()).toEqual([...assemblyAssetFiles].sort());
  expect(assemblyAssets["context.ts"]).toContain("export class Block");
  expect(assemblyAssets["context.ts"]).toContain("export abstract class ExecutionContext");
  expect(assemblyAssets["context.ts"]).toContain("export interface Pss<T>");
  expect(assemblyAssets["context.ts"]).toContain("static pushAll");
  expect(assemblyAssets["context.ts"]).toContain("static outputCountOf");
  expect(assemblyAssets["blocks.ts"]).toContain("export class gpio_in");
  expect(assemblyAssets["blocks.ts"]).toContain("export class const_f32");
  expect(assemblyAssets["blocks.ts"]).toContain("Block.pushAll");
  expect(assemblyAssets["blocks.ts"]).toContain("Block.outputCountOf");
  expect(assemblyAssets["blocks.ts"]).not.toMatch(/function pushAll\(/);
  expect(assemblyAssets["blocks.ts"]).not.toMatch(/function outputCountOf\(/);
  expect(assemblyAssets["index.ts"]).toContain('from "./context"');
  expect(assemblyAssets["index.ts"]).toContain('from "./blocks"');
});

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserAsRuntime).toBeTypeOf("function");
});
