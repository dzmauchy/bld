import { describe, expect, test } from "vitest";
import {
  DataType,
  ParameterizedType,
  PrimitiveType,
  TypeSystem,
  TypeVariable,
} from "../../../src/types/index.js";

describe("TypeSystem & DataTypes", () => {
  test("creates and compares PrimitiveTypes", () => {
    const f32 = new PrimitiveType("f32", "32-bit Float", "Float type", new Set(["i32", "u32"]));
    expect(f32.raw).toBe("f32");
    expect(f32.toString()).toBe("f32");
    expect(f32.isArgCompatibleWith("i32")).toBe(true);
    expect(f32.isArgCompatibleWith("str")).toBe(false);

    const f32Copy = new PrimitiveType("f32", "32-bit Float");
    expect(f32.equals(f32Copy)).toBe(true);
  });

  test("creates and compares ParameterizedTypes", () => {
    const f32 = new PrimitiveType("f32", "32-bit Float");
    const pssF32 = new ParameterizedType(
      "pss",
      "Push stream",
      "Stream type",
      new Map([["T", f32]]),
    );

    expect(pssF32.raw).toBe("pss");
    expect(pssF32.getArg("T")?.raw).toBe("f32");
    expect(pssF32.toString()).toBe("pss<T=f32>");

    const u8 = new PrimitiveType("u8", "8-bit Unsigned Integer");
    const pssU8 = new ParameterizedType("pss", "Push stream", "", new Map([["T", u8]]));
    expect(pssF32.equals(pssU8)).toBe(false);
  });

  test("loads from default types catalog", () => {
    const ts = TypeSystem.createDefault();
    const boolType = ts.getPrimitive("bool");
    expect(boolType).toBeDefined();
    expect(boolType?.name).toBe("Boolean");

    // as_arg_compatible_with for bool includes integer and float types per types.json
    expect(boolType?.isArgCompatibleWith("i8")).toBe(true);
    expect(boolType?.isArgCompatibleWith("f32")).toBe(true);

    const pssTemplate = ts.getParameterizedTemplate("pss");
    expect(pssTemplate).toBeDefined();
    expect(pssTemplate?.params).toContain("T");
  });

  test("parses JSON type descriptors", () => {
    const ts = TypeSystem.createDefault();

    // Primitive string
    const f32 = ts.parse("f32");
    expect(f32).toBeInstanceOf(PrimitiveType);
    expect(f32.raw).toBe("f32");

    // Parameterized descriptor
    const pss = ts.parse({
      raw: "pss",
      args: { T: { raw: "f32" } },
    });
    expect(pss).toBeInstanceOf(ParameterizedType);
    expect((pss as ParameterizedType).getArg("T")?.raw).toBe("f32");

    // Nested parameterized descriptor
    const arrayPss = ts.parse({
      raw: "array",
      args: {
        T: {
          raw: "pss",
          args: { T: { raw: "f32" } },
        },
      },
    });
    expect(arrayPss).toBeInstanceOf(ParameterizedType);
    const inner = (arrayPss as ParameterizedType).getArg("T") as ParameterizedType;
    expect(inner.raw).toBe("pss");
    expect(inner.getArg("T")?.raw).toBe("f32");
  });

  test("evaluates compatibility based on types.json rules", () => {
    const ts = TypeSystem.createDefault();
    const f32 = ts.parse("f32");
    const i32 = ts.parse("i32");
    const str = ts.parse("str");

    // f32 is compatible with f32
    expect(ts.isCompatible(f32, f32)).toBe(true);

    // in types.json, f32 accepts i32 as arg
    expect(ts.isCompatible(i32, f32)).toBe(true);

    // str is not compatible with f32
    expect(ts.isCompatible(str, f32)).toBe(false);

    // Parameterized: pss<f32> with pss<f32>
    const pssF32_1 = ts.parse({ raw: "pss", args: { T: { raw: "f32" } } });
    const pssF32_2 = ts.parse({ raw: "pss", args: { T: { raw: "f32" } } });
    const pssU8 = ts.parse({ raw: "pss", args: { T: { raw: "u8" } } });

    expect(ts.isCompatible(pssF32_1, pssF32_2)).toBe(true);
    expect(ts.isCompatible(pssF32_1, pssU8)).toBe(false);
  });
});
