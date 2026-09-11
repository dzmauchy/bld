import { beforeAll, describe, expect, test } from "@rstest/core";
import { ClangTranslationUnit, ClangTypeCatalog } from "../../../src/model/clangAst.ts";
import { HostClangAstDumper } from "../../../src/model/hostClangAstDumper.ts";
import { Library } from "../../../src/model/library.ts";

describe("clang++ AST type dump", () => {
  const dumper = HostClangAstDumper.shared;
  const catalog = new ClangTypeCatalog(dumper);

  beforeAll(async () => {
    await Library.load("base.json");
  });

  test("dumps QualTypes for library apply methods", () => {
    const scope = catalog.shapeFor("push::f32::sinks::ScopeF32");
    expect(scope.apply.returnType.qualType).toContain("VectorizedInput");
    expect(scope.exposesConsumerBank).toBe(true);

    const cosine = catalog.shapeFor("push::f32::transformers::CosF32");
    expect(cosine.returnsScalarConsumer).toBe(true);
    expect(cosine.downstreamType()?.qualType).toContain("VectorizedInput");

    const product = catalog.shapeFor("push::f32::transformers::ProductF32");
    expect(product.returnsIndexedConsumers).toBe(true);
    expect(product.apply.parameters.some((param) => param.qualType === "u8")).toBe(true);

    const constant = catalog.shapeFor("push::f32::sources::ConstF32");
    expect(constant.returnsVoid).toBe(true);
    expect(constant.appliesDownstream).toBe(true);

    const gpio = catalog.shapeFor("push::f32::sources::GpioInF32");
    expect(gpio.registersHostPins).toBe(true);
    expect(gpio.connectPin?.parameters[1]?.qualType).toContain("VectorizedInput");
  });

  test("detects type incompatibilities from clang diagnostics", () => {
    const dump = catalog.dumpProbe(`
#include "base.hpp"
void check() {
  Pss<f32> *from = nullptr;
  int *to = nullptr;
  to = from;
  VectorizedInput<Pss<F32>> dn{};
  dn.push_back(0);
}
`);
    expect(dump.ok).toBe(false);
    expect(dump.hasTypeError).toBe(true);
    expect(dump.diagnostics).toMatch(/cannot initialize|incompatible|cannot convert|no matching/i);
  });

  test("accepts compatible consumer pointer assignment", () => {
    const dump = catalog.dumpProbe(`
#include "base.hpp"
void check() {
  auto* scope = new push::f32::sinks::ScopeF32(0u, 60u, 10u);
  auto sinks = scope->apply(static_cast<u8>(1));
  auto* cosine = new push::f32::transformers::CosF32(1u);
  auto dn = VectorizedInput<Pss<F32>>{};
  dn.push_back(sinks[0]);
  auto* input = cosine->apply(static_cast<VectorizedInput<Pss<F32>>&&>(dn));
  (void)input;
}
`);
    expect(dump.ok, dump.diagnostics).toBe(true);
  });

  test("parses named VarDecl types from a probe dump", () => {
    const dump = catalog.dumpProbe(`
#include "base.hpp"
void probe() {
  auto* scope = new push::f32::sinks::ScopeF32(0u, 60u, 10u);
  auto port_scope_output_sink = scope->apply(static_cast<u8>(1));
}
`);
    expect(dump.ok, dump.diagnostics).toBe(true);
    const unit = ClangTranslationUnit.parse(dump.ast);
    expect(unit.varType("port_scope_output_sink")?.qualType).toContain("VectorizedInput");
    expect(unit.varType("port_scope_output_sink")?.desugaredQualType).toMatch(/Consumer/);
  });
});
