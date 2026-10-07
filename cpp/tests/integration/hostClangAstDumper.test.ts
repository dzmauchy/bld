import { expect, test } from "@rstest/core";
import { ClangTranslationUnit } from "../../src/clangAst.ts";
import { HostClangAstDumper } from "../../src/hostClangAstDumper.ts";

test("native clang reads included headers without precompilation and retains source types and comments", () => {
  const files = new Map([
    ["value.hpp", "#pragma once\nstruct HeaderOnly {};\ninline int value(int fallback = 42) { return fallback; }"],
    ["main.cpp", '#include "value.hpp"\n// Source comment with π and JSON punctuation: {"value": "[42]"}.\nint answer() { auto inferred = value(); return inferred; }'],
  ]);
  const dumper = new HostClangAstDumper();
  const first = dumper.dump(files, "main.cpp");
  expect(first.ok, first.diagnostics).toBe(true);
  const ast = JSON.stringify(first.ast);
  expect(ast).toContain('"name":"answer"');
  expect(ast).toContain("Source comment with π");
  expect(ast).not.toContain('"name":"HeaderOnly"');
  expect(ClangTranslationUnit.parse(first.ast).varType("inferred")?.canonical).toBe("int");
  files.set("value.hpp", "#pragma once\ninline double value() { return 43.5; }");
  const changed = dumper.dump(files, "main.cpp");
  expect(changed.ok, changed.diagnostics).toBe(true);
  expect(ClangTranslationUnit.parse(changed.ast).varType("inferred")?.canonical).toBe("double");
});
