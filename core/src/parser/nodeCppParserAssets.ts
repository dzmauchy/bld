/**
 * Loads the C++ grammar from the installed npm package. Used by Node tests.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CppParserAssets } from "./cppParserAssets";

export class NodeCppParserAssets extends CppParserAssets {
  override initOptions(): undefined {
    return undefined;
  }

  override language(): Promise<Uint8Array> {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("tree-sitter-cpp/package.json");
    return Promise.resolve(new Uint8Array(readFileSync(join(dirname(pkg), "tree-sitter-cpp.wasm"))));
  }
}

export const cppParserAssets: CppParserAssets = new NodeCppParserAssets();
