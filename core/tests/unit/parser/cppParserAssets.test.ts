import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import Parser from "web-tree-sitter";
import { cppParserAssets } from "#parser-assets";
import { BrowserCppParserAssets } from "../../../src/parser/browserCppParserAssets.ts";
import { NodeCppParserAssets } from "../../../src/parser/nodeCppParserAssets.ts";

test("node resolves the filesystem parser assets", () => {
  expect(cppParserAssets).toBeInstanceOf(NodeCppParserAssets);
});

test("client syntax sources do not import Node builtins", () => {
  const syntax = readFileSync(new URL("../../../src/model/cppSyntax.ts", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../../../src/parser/browserCppParserAssets.ts", import.meta.url), "utf8");
  const nodeImport = /from\s+["']node:|import\s*\(\s*["']node:/;
  expect(syntax).not.toMatch(nodeImport);
  expect(browser).not.toMatch(nodeImport);
});

test("browser parser assets load the C++ grammar from wasm urls", async () => {
  const assets = new BrowserCppParserAssets();
  const init = assets.initOptions() as { locateFile: (file: string, prefix: string) => string };
  const runtimeUrl = new URL(init.locateFile("tree-sitter.wasm", ""));
  expect(readFileSync(runtimeUrl).byteLength).toBeGreaterThan(1000);

  await Parser.init(init);
  const language = await Parser.Language.load(readFileSync(assets.languageWasm));
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse("struct A { int x; };");
  expect(tree.rootNode.type).toBe("translation_unit");
  expect(tree.rootNode.text).toContain("struct A");
});
