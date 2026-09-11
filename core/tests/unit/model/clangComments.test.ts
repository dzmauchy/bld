import { describe, expect, test } from "@rstest/core";
import {
  ClangComment,
  ClangSourceComments,
  Diagram,
  HeaderCatalog,
  JsonComment,
  Library,
  isMainFileNode,
} from "../../../src/model/index.js";

describe("AST JSON comments", () => {
  test("parses block and line comments with markers", () => {
    expect(JsonComment.fromText('/*{"kind":"block","id":"demo"}*/')?.value).toMatchObject({ kind: "block", id: "demo" });
    expect(JsonComment.fromText('// {"kind":"conf","id":"gain"}')?.value).toMatchObject({ kind: "conf", id: "gain" });
    expect(JsonComment.fromText("int x;")).toBeUndefined();
    expect(JsonComment.fromText("/* not json */")).toBeUndefined();
  });

  test("rejects malformed JSON bodies", () => {
    expect(() => JsonComment.fromText('/*{"kind":}*/')).toThrow(/not valid JSON/);
  });

  test("parses raw AST comment bodies without markers", () => {
    expect(JsonComment.fromJsonBody('{"kind":"type","id":"t"}')?.kind).toBe("type");
    expect(JsonComment.fromJsonBody("plain text")).toBeUndefined();
  });

  test("joins split TextComments into one JSON object", () => {
    const full = {
      kind: "FullComment",
      inner: [
        {
          kind: "ParagraphComment",
          inner: [
            { kind: "TextComment", text: ' {"id":"demo","title":"Demo",' },
            { kind: "TextComment", text: ' "blocks":{},"connections":{}}' },
          ],
        },
      ],
    };
    const comment = new ClangComment(full);
    expect(comment.texts()).toHaveLength(2);
    expect(comment.asJson()?.value).toMatchObject({ id: "demo", title: "Demo" });
  });

  test("finds the FullComment child of a declaration", () => {
    const decl = { kind: "CXXRecordDecl", name: "Demo", inner: [{ kind: "FullComment", inner: [] }] };
    expect(ClangComment.of(decl)).toBeInstanceOf(ClangComment);
    expect(ClangComment.of({ kind: "CXXRecordDecl", name: "Plain", inner: [] })).toBeUndefined();
  });
});

describe("AST source offsets", () => {
  test("reads the block comment immediately before an offset", () => {
    const source = 'class A {\n  /*{"kind":"conf","id":"gain"}*/\n  int gain;\n};';
    const offset = source.indexOf("int gain");
    expect(ClangSourceComments.precedingBlockJson(source, offset)?.value).toMatchObject({ id: "gain" });
  });

  test("ignores comments separated by code", () => {
    const source = '/*{"kind":"conf","id":"a"}*/ int a; int b;';
    expect(ClangSourceComments.precedingBlockJson(source, source.indexOf("int b"))).toBeUndefined();
  });

  test("prefers the declaration range begin over the name location", () => {
    const node = { kind: "ParmVarDecl", loc: { offset: 20 }, range: { begin: { offset: 10 } } };
    expect(ClangSourceComments.declBeginOffset(node)).toBe(10);
    expect(ClangSourceComments.declBeginOffset({ kind: "ParmVarDecl", loc: { offset: 20 } })).toBe(20);
  });

  test("detects main-file nodes across clang file abbreviations", () => {
    expect(isMainFileNode({ kind: "TypeAliasDecl", loc: { offset: 10 } }, "custom.hpp")).toBe(true);
    expect(isMainFileNode({ kind: "TypeAliasDecl", loc: { offset: 10, file: "/tmp/x/custom.hpp" } }, "custom.hpp")).toBe(true);
    expect(isMainFileNode({ kind: "TypeAliasDecl", loc: { offset: 10, file: "/tmp/x/other.hpp" } }, "custom.hpp")).toBe(false);
    expect(isMainFileNode({ kind: "TypeAliasDecl", loc: { offset: 10, includedFrom: { file: "/tmp/x/main.cpp" } } }, "custom.hpp")).toBe(
      false,
    );
    expect(isMainFileNode({ kind: "NamespaceDecl", loc: { offset: 10, file: "/usr/include/stdc.h" } }, "custom.hpp")).toBe(false);
  });
});

describe("HeaderCatalog from clang AST", () => {
  test("reads types, namespaces, blocks, ports, and config from comments", async () => {
    const source = [
      '/*{"kind":"type","id":"custom_t","name":"Custom"}*/',
      "using custom_t = int;",
      '/*{"kind":"namespace","name":"Custom NS"}*/',
      "namespace custom_ns {",
      '/*{"kind":"block","id":"custom_block","ns":["custom_ns"],"title":"Custom","description":"desc"}*/',
      "class CustomBlock {",
      " public:",
      "  explicit CustomBlock(",
      "      unsigned blockId,",
      '      /*{"kind":"conf","id":"gain","type":{"raw":"u32"},"control":{"type":"slider","default":3}}*/',
      "      unsigned gain = 3) {}",
      '  /*{"kind":"input","vector":true,"type":{"raw":"custom_t"}}*/',
      "  using v = int*;",
      "};",
      "}",
      "",
    ].join("\n");
    const catalog = await HeaderCatalog.parse(new Map([["custom.hpp", source]]), ["custom.hpp"]);
    expect(catalog.types.custom_t?.name).toBe("Custom");
    expect(catalog.namespaces.custom_ns).toMatchObject({ name: "Custom NS" });
    expect(catalog.blocks.custom_block).toMatchObject({ title: "Custom", cpp: "custom_ns::CustomBlock" });
    expect(catalog.blocks.custom_block?.inputs?.v?.vector).toBe(true);
    expect(catalog.blocks.custom_block?.conf?.gain?.control).toMatchObject({ type: "slider", default: 3 });
  });
});

describe("Diagram.fromCpp from clang AST", () => {
  test("rejects sources without mount()", async () => {
    const palette = (await Library.load("base.json")).palette;
    await expect(Diagram.fromCpp("int lonely = 1;\n", palette)).rejects.toThrow(/must define mount\(\)/);
  });

  test("rejects mount() without a diagram comment", async () => {
    const palette = (await Library.load("base.json")).palette;
    await expect(Diagram.fromCpp('extern "C" void mount() {}\n', palette)).rejects.toThrow(/missing a JSON comment/);
  });
});
