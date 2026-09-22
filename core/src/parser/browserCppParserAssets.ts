/**
 * Points the browser bundle at emitted wasm assets. The UI has no Node filesystem.
 */
import { CppParserAssets } from "./cppParserAssets";

const runtimeWasmUrl = new URL(
  "../../../node_modules/web-tree-sitter/tree-sitter.wasm",
  import.meta.url,
);

const languageWasmUrl = new URL(
  "../../../node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm",
  import.meta.url,
);

export class BrowserCppParserAssets extends CppParserAssets {
  get languageWasm(): URL {
    return languageWasmUrl;
  }

  override initOptions(): object {
    const runtimeWasm = runtimeWasmUrl.href;
    return {
      locateFile(file: string, prefix: string): string {
        return file.endsWith(".wasm") ? runtimeWasm : `${prefix}${file}`;
      },
    };
  }

  override async language(): Promise<Uint8Array> {
    const response = await fetch(languageWasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load the C++ grammar (${response.status}) from ${languageWasmUrl.href}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export const cppParserAssets: CppParserAssets = new BrowserCppParserAssets();
