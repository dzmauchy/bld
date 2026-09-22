/**
 * Supplies the tree-sitter runtime and C++ grammar to the syntax parser.
 * Node tests and the browser UI each provide their own subclass.
 */
export abstract class CppParserAssets {
  abstract initOptions(): object | undefined;
  abstract language(): Promise<Uint8Array>;
}
