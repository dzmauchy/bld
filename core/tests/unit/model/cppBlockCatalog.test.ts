import { describe, expect, test } from "vitest";
import { defaultCppBlockCatalog } from "../../../src/model/cppBlockCatalog.ts";

describe("CppBlockCatalog", () => {
  test("maps every f32 base library class", () => {
    expect(defaultCppBlockCatalog.require("scope_f32").cppClass).toBe("push::f32::sinks::ScopeF32");
    expect(defaultCppBlockCatalog.require("cos_f32").cppClass).toBe("push::f32::transformers::CosF32");
    expect(defaultCppBlockCatalog.require("sin_f32").cppClass).toBe("push::f32::transformers::SinF32");
    expect(defaultCppBlockCatalog.require("product_f32").cppClass).toBe("push::f32::transformers::ProductF32");
    expect(defaultCppBlockCatalog.require("sum_f32").cppClass).toBe("push::f32::transformers::SumF32");
    expect(defaultCppBlockCatalog.require("const_f32").cppClass).toBe("push::f32::sources::ConstF32");
    expect(defaultCppBlockCatalog.require("cos_gen_f32").cppClass).toBe("push::f32::sources::CosGenF32");
    expect(defaultCppBlockCatalog.require("sin_gen_f32").cppClass).toBe("push::f32::sources::SinGenF32");
    expect(defaultCppBlockCatalog.require("rand_gen_f32").cppClass).toBe("push::f32::sources::RandGenF32");
    expect(defaultCppBlockCatalog.require("pulse_gen_f32").cppClass).toBe("push::f32::sources::PulseGenF32");
    expect(defaultCppBlockCatalog.require("gpio_in_f32").cppClass).toBe("push::f32::sources::GpioInF32");
  });

  test("classifies blocks by C++ apply shape", () => {
    expect(defaultCppBlockCatalog.require("scope_f32").kind).toBe("sink");
    expect(defaultCppBlockCatalog.require("cos_f32").kind).toBe("unary");
    expect(defaultCppBlockCatalog.require("product_f32").kind).toBe("aggregate");
    expect(defaultCppBlockCatalog.require("sum_f32").kind).toBe("aggregate");
    expect(defaultCppBlockCatalog.require("const_f32").kind).toBe("source");
    expect(defaultCppBlockCatalog.require("gpio_in_f32").kind).toBe("gpio");
  });

  test("rejects unknown refs", () => {
    expect(defaultCppBlockCatalog.has("gpio_in")).toBe(false);
    expect(() => defaultCppBlockCatalog.require("unknown")).toThrow(/Unknown C\+\+ block/);
  });
});
