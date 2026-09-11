import { beforeAll, describe, expect, test } from "vitest";
import {
  ParameterizedType,
  PrimitiveType,
  TypeInference,
  TypeSystem,
  TypeVariable,
} from "../../../src/types/index.js";
import { Library } from "../../../src/model/index.js";

describe("TypeInference", () => {
  let ts: TypeSystem;
  let inference: TypeInference;

  beforeAll(async () => {
    const lib = await Library.load("base.json");
    ts = lib.typeSystem;
    inference = new TypeInference(ts);
  });

  test("infers port payload type and stream classification", () => {
    const pssF32 = ts.parse({ raw: "pss", args: { T: { raw: "f32" } } });
    const port = {
      type: pssF32,
      vector: true,
    };

    const inferred = inference.inferPort(port);
    expect(inferred.isStream).toBe(true);
    expect(inferred.isVector).toBe(true);
    expect(inferred.payloadType?.raw).toBe("f32");
  });

  test("infers vector length from concept configuration binding", () => {
    const arrayPssF32 = ts.parse({
      raw: "array",
      args: { T: { raw: "pss", args: { T: { raw: "f32" } } } },
    });

    const port = {
      type: arrayPssF32,
      vector: false,
      concept: {
        length: {
          bind: {
            type: "conf",
            id: "pins",
          },
        },
      },
    };

    // With config having 3 pins
    const conf = { pins: [0, 1, 4] };
    const inferred = inference.inferPort(port, conf);

    expect(inferred.isStream).toBe(true);
    expect(inferred.isVector).toBe(true);
    expect(inferred.vectorLength).toBe(3);
    expect(inferred.payloadType?.raw).toBe("f32");
  });

  test("unifies generic type variables with concrete types", () => {
    const typeVarT = new TypeVariable("T");
    const targetType = new ParameterizedType(
      "pss",
      "Push stream",
      "",
      new Map([["T", typeVarT]]),
    );

    const f64 = new PrimitiveType("f64", "64-bit Float");
    const sourceType = new ParameterizedType(
      "pss",
      "Push stream",
      "",
      new Map([["T", f64]]),
    );

    const result = inference.unify(sourceType, targetType);
    expect(result.ok).toBe(true);
    expect(result.bindings.get("T")?.raw).toBe("f64");
  });

  test("infers connection transmission type between compatible ports", () => {
    const pssF32 = ts.parse({ raw: "pss", args: { T: { raw: "f32" } } });

    const fromPort = inference.inferPort({ type: pssF32, vector: true });
    const toPort = inference.inferPort({ type: pssF32, vector: true });

    const result = inference.inferConnection(fromPort, toPort);
    expect(result.ok).toBe(true);
    expect(result.payloadType?.raw).toBe("f32");
    expect(result.effectiveType?.raw).toBe("pss");
  });

  test("rejects connection inference between incompatible types", () => {
    const pssF32 = ts.parse({ raw: "pss", args: { T: { raw: "f32" } } });
    const u8 = ts.parse("u8");

    const result = inference.inferConnection(pssF32, u8);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Incompatible types");
  });

  test("infers types of literal values", () => {
    expect(inference.inferLiteralType(true).raw).toBe("bool");
    expect(inference.inferLiteralType(255).raw).toBe("u8");
    expect(inference.inferLiteralType(1000).raw).toBe("u32");
    expect(inference.inferLiteralType(3.14).raw).toBe("f32");
    expect(inference.inferLiteralType("hello").raw).toBe("str");

    const arrType = inference.inferLiteralType([10, 20]);
    expect(arrType.raw).toBe("array");
    expect((arrType as ParameterizedType).getArg("T")?.raw).toBe("u8");
  });
});
