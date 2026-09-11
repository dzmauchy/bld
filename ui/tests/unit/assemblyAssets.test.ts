import { expect, test } from "vitest";
import { assemblyAssetFiles } from "core";
import { assemblyAssets } from "../../src/assemblyAssets.ts";
import { createBrowserAsRuntime } from "../../src/as/runtime.ts";

test("loads every core AssemblyScript library file as a source asset", () => {
  expect(Object.keys(assemblyAssets).sort()).toEqual([...assemblyAssetFiles].sort());
  expect(assemblyAssets["basic.ts"]).toContain("export class Block");
  expect(assemblyAssets["context.ts"]).toContain("export abstract class ExecutionContext");
  expect(assemblyAssets["gpio.ts"]).toContain("export class gpio_in");
  expect(assemblyAssets["index.ts"]).toContain('export { Block } from "./basic"');
  expect(assemblyAssets["push.ts"]).toContain("export class const_f32");
  expect(assemblyAssets["types.ts"]).toContain("export interface Pss<T>");
});

test("browser runtime factory is exported for UI wasm hosts", () => {
  expect(createBrowserAsRuntime).toBeTypeOf("function");
});
