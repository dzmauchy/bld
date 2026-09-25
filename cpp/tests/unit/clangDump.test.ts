import { describe, expect, test } from "@rstest/core";
import { ClangAstDumper, CppTypeNames, JsonComment, cppIdent } from "../../src/index.ts";
import { HostClangAstDumper } from "../../src/hostClangAstDumper.ts";

describe("clang dump host", () => {
  test("host dumper is the registered clang AST dumper", () => {
    expect(HostClangAstDumper.prototype).toBeInstanceOf(ClangAstDumper);
    expect(ClangAstDumper.defaultDumper()).toBe(HostClangAstDumper.shared);
  });
});

describe("C++ literals", () => {
  test("formats clang qual types without a diagram", () => {
    expect(CppTypeNames.literalFromClang("f32", 3)).toBe("3.f");
    expect(CppTypeNames.literalFromClang("u32", 4)).toBe("4u");
    expect(CppTypeNames.isArrayQualType("Array<u8>")).toBe(true);
    expect(cppIdent("1scope")).toBe("b_1scope");
  });

  test("parses JSON comments from clang text", () => {
    expect(JsonComment.fromText('/*{"kind":"block","id":"demo"}*/')?.kind).toBe("block");
    expect(JsonComment.fromText("int x;")).toBeUndefined();
  });
});
