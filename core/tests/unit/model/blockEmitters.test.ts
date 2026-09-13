import { beforeAll, describe, expect, test } from "vitest";
import {
  BlockEmitterRegistryView,
  defaultBlockEmitters,
  type IBlockRegistryView,
} from "../../../src/model/blockEmitters.ts";
import { Library } from "../../../src/model/library.ts";
import { BlockRegistry } from "runtime";

beforeAll(async () => {
  await Library.load("base.json");
});

describe("BlockEmitterRegistryView", () => {
  test("implements IBlockRegistryView contract", () => {
    const customRegistry = new BlockRegistry();
    customRegistry.define("test_block", () => {});
    const view: IBlockRegistryView = new BlockEmitterRegistryView(customRegistry);

    expect(view.has("test_block")).toBe(true);
    expect(view.has("non_existent")).toBe(false);
  });

  test("defaultBlockEmitters is agnostic about block execution types", () => {
    // Blocks are queried without requiring them to belong to any specific push or tick class
    expect(defaultBlockEmitters.has("scope_f32")).toBe(true);
    expect(defaultBlockEmitters.has("const_f32")).toBe(true);
    expect(defaultBlockEmitters.has("cos_f32")).toBe(true);
    expect(defaultBlockEmitters.has("gpio_in")).toBe(true);
    expect(defaultBlockEmitters.has("non_existent")).toBe(false);
  });
});
