import { describe, expect, test } from "@rstest/core";
import type { ClangAstJson } from "cpp";
import { ClangConstructorCatalog } from "../../../src/model/clangConstructorCatalog";

describe("Clang constructor catalog", () => {
  test("reads types and defaults from a precompiled-header constructor call", () => {
    const catalog = ClangConstructorCatalog.fromAst(translationUnit([
      construct("push::f_32::sinks::ScopeF32", "void (const u32, const u32, const u32)", [
        literal("IntegerLiteral", "unsigned int", "0"),
        defaultArg("u32", "unsigned int", literal("IntegerLiteral", "int", "60")),
        defaultArg("u32", "unsigned int", literal("IntegerLiteral", "int", "10")),
      ]),
      construct("push::f_32::sources::ConstF32", "void (const u32, const T)", [
        literal("IntegerLiteral", "unsigned int", "1"),
        defaultArg("T", "float", literal("IntegerLiteral", "int", "1")),
      ]),
      construct("push::f_32::sources::PulseGenF32", "void (const u32, const T, const T)", [
        literal("IntegerLiteral", "unsigned int", "0"),
        defaultArg("T", "float", {
          kind: "InitListExpr",
          inner: [literal("FloatingLiteral", "float", "0.5")],
        }),
        defaultArg("T", "float", literal("IntegerLiteral", "int", "1")),
      ]),
      construct("push::f_32::sources::GpioInF32", "void (const u32, const u16, Array<u8>)", [
        literal("IntegerLiteral", "unsigned int", "0"),
        defaultArg("u16", "unsigned short", literal("IntegerLiteral", "int", "0")),
        defaultArg("Array<u8>", "push::Array<unsigned char>", {
          kind: "InitListExpr",
          inner: [literal("IntegerLiteral", "int", "0")],
        }),
      ]),
      construct("push::f_32::sinks::ScopeF32", "void (const push::f_32::sinks::ScopeF32 &)", [
        { kind: "DeclRefExpr", type: { qualType: "const push::f_32::sinks::ScopeF32 &" } },
      ]),
    ]));

    expect(catalog.parametersFor("push::f_32::sinks::ScopeF32")).toBeUndefined();
    expect(catalog.constructedParameters("push::f_32::sinks::ScopeF32")).toEqual([
      { name: "", type: "unsigned int", defaultValue: 60 },
      { name: "", type: "unsigned int", defaultValue: 10 },
    ]);
    expect(catalog.constructedParameters("push::f_32::sources::ConstF32")).toEqual([
      { name: "", type: "float", defaultValue: 1 },
    ]);
    expect(catalog.constructedParameters("push::f_32::sources::PulseGenF32")).toEqual([
      { name: "", type: "float", defaultValue: 0.5 },
      { name: "", type: "float", defaultValue: 1 },
    ]);
    expect(catalog.constructedParameters("push::f_32::sources::GpioInF32")).toEqual([
      { name: "", type: "unsigned short", defaultValue: 0 },
      { name: "", type: "push::Array<unsigned char>", defaultValue: [0] },
    ]);
  });
});

function translationUnit(inner: ClangAstJson[]): ClangAstJson {
  return { kind: "TranslationUnitDecl", inner };
}

function construct(qualType: string, ctorType: string, inner: ClangAstJson[]): ClangAstJson {
  return {
    kind: "CXXConstructExpr",
    type: { qualType },
    ctorType: { qualType: ctorType },
    inner,
  } as ClangAstJson;
}

function defaultArg(qualType: string, desugaredQualType: string, inner: ClangAstJson): ClangAstJson {
  return {
    kind: "CXXDefaultArgExpr",
    type: { qualType, desugaredQualType },
    inner: [inner],
  };
}

function literal(kind: string, qualType: string, value: string): ClangAstJson {
  return { kind, type: { qualType }, value } as ClangAstJson;
}
