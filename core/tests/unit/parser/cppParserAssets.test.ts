import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { TreeSitterCppSyntax } from "../../../src/model/cppSyntax.ts";
import { cppParserAssets } from "../../../src/parser/cppParserAssets.ts";

test("parser asset loader does not import Node builtins", () => {
  const syntax = readFileSync(new URL("../../../src/model/cppSyntax.ts", import.meta.url), "utf8");
  const assets = readFileSync(new URL("../../../src/parser/cppParserAssets.ts", import.meta.url), "utf8");
  const nodeImport = /from\s+["']node:|import\s*\(\s*["']node:/;
  expect(syntax).not.toMatch(nodeImport);
  expect(assets).not.toMatch(nodeImport);
});

test("fetches the C++ grammar wasm", async () => {
  const bytes = await cppParserAssets.language();
  expect(Buffer.from(bytes.subarray(0, 4)).toString("utf8")).toBe("\0asm");
});

test("parses C++ with the fetched grammar", async () => {
  const syntax = await TreeSitterCppSyntax.create();
  const tree = syntax.parse("struct A { int x; };");
  expect(tree.root.type).toBe("translation_unit");
  expect(tree.root.text).toContain("struct A");
});
