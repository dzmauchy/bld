import { describe, expect, test } from "@rstest/core";
import { isCppSource, isHeader, objectPathFor, workPath } from "../../src/paths.ts";

describe("virtual source paths", () => {
  test("places user files under /work", () => {
    expect(workPath("src/add.cpp")).toBe("/work/src/add.cpp");
    expect(objectPathFor("src/add.cpp")).toBe("/work/src/add.o");
  });

  test("classifies sources and headers", () => {
    expect(isCppSource("main.cpp")).toBe(true);
    expect(isCppSource("lib.cc")).toBe(true);
    expect(isCppSource("add.h")).toBe(false);
    expect(isCppSource("wasm_host.inc")).toBe(false);
    expect(isHeader("add.hpp")).toBe(true);
    expect(isHeader("wasm_host.inc")).toBe(true);
  });

  test("rejects parent traversal", () => {
    expect(() => workPath("../secret.cpp")).toThrow(/invalid virtual path/);
  });
});
