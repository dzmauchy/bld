import { expect, test } from "vitest";
import { assemblyAssetFiles } from "core";
import { assemblyAssets } from "./assemblyAssets.ts";
import { createBrowserAsRuntime } from "./as/runtime.ts";

test("loads every core AssemblyScript library file as a source asset", () => {
  expect(Object.keys(assemblyAssets).sort()).toEqual([...assemblyAssetFiles].sort());
  expect(assemblyAssets["basic.ts"]).toContain("export class Block");
  expect(assemblyAssets["context.ts"]).toContain("export abstract class ExecutionContext");
  expect(assemblyAssets["gpio.ts"]).toContain("export class GpioIn");
  expect(assemblyAssets["index.ts"]).toContain('export { Block, Widths } from "./basic"');
  expect(assemblyAssets["push.ts"]).toContain("export class ConstF32");
  expect(assemblyAssets["types.ts"]).toContain("export interface Pss<T>");
});

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserAsRuntime).toBeTypeOf("function");
});
