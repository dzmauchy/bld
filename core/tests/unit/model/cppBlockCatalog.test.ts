import { beforeAll, describe, expect, test } from "vitest";
import {
  CppBlockCatalog,
  CppTypeNames,
  defaultCppBlockCatalog,
} from "../../../src/model/cppBlockCatalog.ts";
import { Library } from "../../../src/model/library.ts";

describe("CppBlockCatalog", () => {
  let catalog: CppBlockCatalog;

  beforeAll(async () => {
    const lib = await Library.load("base.json");
    catalog = CppBlockCatalog.fromPalette(lib.palette);
  });

  test("reads C++ class names from blocks.json", () => {
    expect(catalog.require("scope_f32").cppClass).toBe("push::f32::sinks::ScopeF32");
    expect(catalog.require("cos_f32").cppClass).toBe("push::f32::transformers::CosF32");
    expect(catalog.require("sin_f32").cppClass).toBe("push::f32::transformers::SinF32");
    expect(catalog.require("product_f32").cppClass).toBe("push::f32::transformers::ProductF32");
    expect(catalog.require("sum_f32").cppClass).toBe("push::f32::transformers::SumF32");
    expect(catalog.require("const_f32").cppClass).toBe("push::f32::sources::ConstF32");
    expect(catalog.require("cos_gen_f32").cppClass).toBe("push::f32::sources::CosGenF32");
    expect(catalog.require("sin_gen_f32").cppClass).toBe("push::f32::sources::SinGenF32");
    expect(catalog.require("rand_gen_f32").cppClass).toBe("push::f32::sources::RandGenF32");
    expect(catalog.require("pulse_gen_f32").cppClass).toBe("push::f32::sources::PulseGenF32");
    expect(catalog.require("gpio_in_f32").cppClass).toBe("push::f32::sources::GpioInF32");
    expect(defaultCppBlockCatalog.require("scope_f32").cppClass).toBe(catalog.require("scope_f32").cppClass);
  });

  test("gets port and conf types from types.json through the palette", () => {
    const scope = catalog.require("scope_f32");
    expect(scope.getConfig("period")?.type.raw).toBe("u32");
    expect(scope.getConfig("precision")?.type.raw).toBe("u32");
    expect(scope.getOutput("sink")?.type.raw).toBe("pss");
    expect(scope.getOutput("sink")?.type.toString()).toBe("pss<T=f32>");

    const gpio = catalog.require("gpio_in_f32");
    expect(gpio.getConfig("port")?.type.raw).toBe("u16");
    expect(gpio.getConfig("pins")?.type.raw).toBe("array");
    expect(gpio.getConfig("pins")?.type.toString()).toBe("array<T=u8>");
    expect(gpio.getInput("pin")?.type.toString()).toBe("pss<T=f32>");

    const constant = catalog.require("const_f32");
    expect(constant.getConfig("v")?.type.raw).toBe("f32");
  });

  test("derives wiring topology from JSON ports instead of a closed kind union", () => {
    expect(catalog.topology("scope_f32").exposesConsumerBank()).toBe(true);
    expect(catalog.topology("cos_f32").returnsScalarConsumer()).toBe(true);
    expect(catalog.topology("product_f32").returnsIndexedConsumers()).toBe(true);
    expect(catalog.topology("sum_f32").returnsIndexedConsumers()).toBe(true);
    expect(catalog.topology("const_f32").appliesDownstream()).toBe(true);
    expect(catalog.topology("const_f32").exposesConsumerBank()).toBe(false);
    expect(catalog.topology("gpio_in_f32").registersHostPins()).toBe(true);
    expect(catalog.topology("gpio_in_f32").pinBindConfId()).toBe("pins");
  });

  test("maps JSON data types to C++ type names", async () => {
    const lib = await Library.load("base.json");
    const ts = lib.typeSystem;
    expect(CppTypeNames.of(ts.parse("f32"))).toBe("f32");
    expect(CppTypeNames.of(ts.parse("u32"))).toBe("u32");
    expect(CppTypeNames.of(ts.parse({ raw: "pss", args: { T: { raw: "f32" } } }))).toBe("Pss<f32>");
    expect(CppTypeNames.of(ts.parse({ raw: "array", args: { T: { raw: "u8" } } }))).toBe("Array<u8>");
    expect(CppTypeNames.vectorizedInput(ts.parse({ raw: "pss", args: { T: { raw: "f64" } } }))).toBe(
      "VectorizedInput<Pss<f64>>",
    );
    expect(CppTypeNames.literal(ts.parse("u32"), 60)).toBe("60u");
    expect(CppTypeNames.literal(ts.parse("f32"), 1)).toBe("1.f");
    expect(CppTypeNames.literal(ts.parse("u16"), 7)).toBe("7");
  });

  test("rejects unknown refs", () => {
    expect(catalog.has("gpio_in")).toBe(false);
    expect(() => catalog.require("unknown")).toThrow(/Unknown C\+\+ block/);
  });
});
