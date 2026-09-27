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

  test("reads C++ class names from metadata", () => {
    expect(catalog.require("ScopeF32").cppClass).toBe("push::f32::sinks::ScopeF32<>");
    expect(catalog.require("CosF32").cppClass).toBe("push::f32::transformers::CosF32<>");
    expect(catalog.require("GpioInF32").cppClass).toBe("push::f32::sources::GpioInF32<>");
    expect(defaultCppBlockCatalog.require("ScopeF32").cppClass).toBe(catalog.require("ScopeF32").cppClass);
  });

  test("rejects unknown refs", () => {
    expect(catalog.has("gpio_in")).toBe(false);
    expect(() => catalog.require("unknown")).toThrow(/Unknown C\+\+ block/);
  });
});
