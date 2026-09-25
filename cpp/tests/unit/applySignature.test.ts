import { describe, expect, test } from "@rstest/core";
import { ApplySignatureProbe, ClangTranslationUnit, type ClangAstJson } from "../../src/clangAst.ts";

const canonicalScope = "Array<Consumer<float> *> (push::Scope<float>::*)(unsigned char)";
const canonicalCos = "MemberConsumer<push::UnaryTransformer<float>, float, &push::UnaryTransformer<float>::handlePush> *(push::UnaryTransformer<float>::*)(Array<Consumer<float> *>)";
const canonicalPin = "void (push::GpioIn<float>::*)(unsigned char, Array<Consumer<float> *>)";

function method(name: string, qualType: string, params: { name: string; qualType: string; desugaredQualType?: string }[]): ClangAstJson {
  return {
    kind: "CXXMethodDecl",
    name,
    type: { qualType },
    inner: params.map((param) => ({
      kind: "ParmVarDecl",
      name: param.name,
      type: { qualType: param.qualType, ...(param.desugaredQualType ? { desugaredQualType: param.desugaredQualType } : {}) },
    })),
  };
}

function specialization(name: string, arg: string, methods: ClangAstJson[]): ClangAstJson {
  return {
    kind: "ClassTemplateDecl",
    name,
    inner: [
      {
        kind: "ClassTemplateSpecializationDecl",
        name,
        inner: [{ kind: "TemplateArgument", type: { qualType: arg } }, ...methods],
      },
    ],
  };
}

describe("ApplySignatureProbe", () => {
  test("keeps alias spellings from the instantiated method when the member pointer is canonical", () => {
    const ast: ClangAstJson = {
      kind: "TranslationUnitDecl",
      inner: [
        {
          kind: "NamespaceDecl",
          name: "push",
          inner: [
            specialization("Scope", "float", [
              method("apply", "Vectorized<Pss<float>> (u8)", [
                { name: "n", qualType: "u8", desugaredQualType: "unsigned char" },
              ]),
            ]),
            specialization("UnaryTransformer", "float", [
              method("apply", "Consumer<float> *(Vectorized<Pss<float>>)", [
                { name: "downstream", qualType: "Vectorized<Pss<float>>", desugaredQualType: "Array<Consumer<float> *>" },
              ]),
            ]),
            specialization("GpioIn", "float", [
              method("apply", "void ()", []),
              method("connectPin", "void (u8, Vectorized<Pss<float>>)", [
                { name: "pinIndex", qualType: "u8", desugaredQualType: "unsigned char" },
                { name: "sinks", qualType: "Vectorized<Pss<float>>", desugaredQualType: "Array<Consumer<float> *>" },
              ]),
            ]),
          ],
        },
        {
          kind: "VarDecl",
          name: "push__f32__sinks__ScopeF32_apply",
          type: { qualType: "decltype(&push::f32::sinks::ScopeF32::apply)", desugaredQualType: canonicalScope },
        },
        {
          kind: "VarDecl",
          name: "push__f32__transformers__CosF32_apply",
          type: { qualType: "decltype(&push::f32::transformers::CosF32::apply)", desugaredQualType: canonicalCos },
        },
        {
          kind: "VarDecl",
          name: "push__f32__sources__GpioInF32_apply",
          type: { qualType: "decltype(&push::f32::sources::GpioInF32::apply)", desugaredQualType: "void (push::GpioIn<float>::*)()" },
        },
        {
          kind: "VarDecl",
          name: "push__f32__sources__GpioInF32_pin",
          type: { qualType: "decltype(&push::f32::sources::GpioInF32::connectPin)", desugaredQualType: canonicalPin },
        },
      ],
    };
    const unit = ClangTranslationUnit.parse(ast);

    const scope = ApplySignatureProbe.read(unit, "push::f32::sinks::ScopeF32");
    expect(scope.apply.returnType.qualType).toBe("Vectorized<Pss<float>>");
    expect(scope.apply.returnType.isVectorized).toBe(true);
    expect(scope.apply.parameters[0]?.qualType).toBe("u8");

    const cosine = ApplySignatureProbe.read(unit, "push::f32::transformers::CosF32");
    expect(cosine.apply.parameters[0]?.qualType).toBe("Vectorized<Pss<float>>");
    expect(cosine.apply.parameters[0]?.isVectorized).toBe(true);
    expect(cosine.apply.returnType.qualType).toBe("Consumer<float> *");

    const gpio = ApplySignatureProbe.read(unit, "push::f32::sources::GpioInF32");
    expect(gpio.connectPin?.parameters[0]?.qualType).toBe("u8");
    expect(gpio.connectPin?.parameters[1]?.qualType).toContain("Vectorized<");
  });
});
