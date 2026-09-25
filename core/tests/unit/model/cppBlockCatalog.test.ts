import { beforeAll, describe, expect, test } from "@rstest/core";
import {
  CppBlockCatalog,
  defaultCppBlockCatalog,
} from "../../../src/model/cppBlockCatalog.ts";
import { Library } from "../../../src/model/library.ts";

describe("CppBlockCatalog", () => {
  let catalog: CppBlockCatalog;

  beforeAll(async () => {
    const lib = await Library.load("base.json");
    catalog = CppBlockCatalog.fromPalette(lib.palette);
  });

  test("reads C++ class names from header comments", () => {
    expect(catalog.require("scope_f32").cppClass).toBe("push::f32::sinks::ScopeF32");
    expect(catalog.require("cos_f32").cppClass).toBe("push::f32::transformers::CosF32");
    expect(catalog.require("gpio_in_f32").cppClass).toBe("push::f32::sources::GpioInF32");
    expect(defaultCppBlockCatalog.require("scope_f32").cppClass).toBe(catalog.require("scope_f32").cppClass);
  });

  test("derives wiring topology from clang++ apply signatures", () => {
    expect(catalog.topology("scope_f32").exposesConsumerBank()).toBe(true);
    expect(catalog.topology("cos_f32").returnsScalarConsumer()).toBe(true);
    expect(catalog.topology("product_f32").returnsIndexedConsumers()).toBe(true);
    expect(catalog.topology("sum_f32").returnsIndexedConsumers()).toBe(true);
    expect(catalog.topology("const_f32").appliesDownstream()).toBe(true);
    expect(catalog.topology("cos_gen_f32").appliesDownstream()).toBe(true);
    expect(catalog.topology("sin_gen_f32").appliesDownstream()).toBe(true);
    expect(catalog.topology("gpio_in_f32").registersHostPins()).toBe(true);
    expect(catalog.topology("gpio_in_f32").pinBindConfId()).toBe("pins");
    expect(catalog.topology("scope_f32").streamCppType()).toContain("Vectorized<");
  });

  test("reads constructor argument types from the clang AST", () => {
    const scopeCtor = catalog.topology("scope_f32").constructorParameters();
    expect(scopeCtor.map((param) => param.qualType)).toEqual(["u32", "u32", "u32"]);
    const gpioCtor = catalog.topology("gpio_in_f32").constructorParameters();
    expect(gpioCtor[1]?.qualType).toBe("u16");
    expect(gpioCtor[2]?.qualType).toContain("Array");
  });

  test("rejects unknown refs", () => {
    expect(catalog.has("gpio_in")).toBe(false);
    expect(() => catalog.require("unknown")).toThrow(/Unknown C\+\+ block/);
  });
});
