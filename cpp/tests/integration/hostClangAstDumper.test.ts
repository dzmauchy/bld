import { expect, test } from "vitest";
import { ClangComment, ClangTranslationUnit, type ClangAstJson } from "cpp/clangAst.ts";
import { HostClangAstDumper } from "cpp/hostClangAstDumper.ts";

test("native clang reads included headers without precompilation and retains source types and comments", () => {
  const files = new Map([
    ["value.hpp", "#pragma once\nstruct HeaderOnly {};\ninline int value(int fallback = 42) { return fallback; }"],
    ["main.cpp", '#include "value.hpp"\n// Source comment with π and JSON punctuation: {"value": "[42]"}.\nint answer() { auto inferred = value(); return inferred; }'],
  ]);
  const dumper = new HostClangAstDumper();
  const first = dumper.dump(files, "main.cpp");
  expect(first.ok, first.diagnostics).toBe(true);
  expect(first.stdout).toBe("");
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

test("native compiler AST retains diagram identities and declaration comments", () => {
  const metadata = { id: "commented", blocks: { "block-π": { ref: "Custom" } }, connections: { "wire-1": {} } };
  const source = [
    `// ${JSON.stringify(metadata)}`,
    'extern "C" void mount() {',
    '// {"kind":"block","id":"block-π"}',
    'static auto block = 1;',
    '(void)block;',
    '}',
  ].join("\n");
  const dump = new HostClangAstDumper().dump(new Map([["diagram.cpp", source]]), "diagram.cpp");
  expect(dump.ok, dump.diagnostics).toBe(true);
  const comments = new Map<string, unknown>();
  const visit = (node: ClangAstJson): void => {
    if (node.name) comments.set(node.name, ClangComment.of(node)?.asJson()?.value);
    node.inner?.forEach(visit);
  };
  visit(dump.ast as ClangAstJson);
  expect(comments.get("mount")).toEqual(metadata);
  expect(comments.get("block")).toEqual({ kind: "block", id: "block-π" });
});
