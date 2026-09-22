/**
 * Loads the tree-sitter runtime and C++ grammar with fetch.
 *
 * Bundled clients rewrite these URLs to emitted wasm assets. Unbundled runs
 * keep file URLs and fetch those the same way.
 */
const runtimeWasmUrl = new URL(
  "../../../node_modules/web-tree-sitter/tree-sitter.wasm",
  import.meta.url,
);

const languageWasmUrl = new URL(
  "../../../node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm",
  import.meta.url,
);

export class CppParserAssets {
  async runtime(): Promise<Uint8Array> {
    return this.read(runtimeWasmUrl);
  }

  async language(): Promise<Uint8Array> {
    return this.read(languageWasmUrl);
  }

  private async read(url: URL): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${url.href}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}

export const cppParserAssets = new CppParserAssets();
