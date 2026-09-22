import {
  BrowserEmscriptenToolchain,
  defaultClangOptions,
  type ClangCompileOptions,
  type WasmToolchain,
} from "./target.ts";

export type { ClangCompileOptions };
export { BrowserEmscriptenToolchain, McuUnknownToolchain, defaultClangOptions } from "./target.ts";

export class ClangArgumentBuilder {
  constructor(
    private readonly toolchain: WasmToolchain = new BrowserEmscriptenToolchain(),
    private readonly options: ClangCompileOptions = defaultClangOptions,
  ) {}

  withResourceDir(resourceDir: string): ClangArgumentBuilder {
    return new ClangArgumentBuilder(this.toolchain, { ...this.options, resourceDir });
  }

  syntaxOnlyAstDump(sourcePath: string): string[] {
    return this.toolchain.syntaxOnlyAstDump(sourcePath, this.options);
  }

  emitAst(sourcePath: string): string[] {
    return this.toolchain.emitAst(sourcePath, this.options);
  }

  build(sourcePath: string, objectPath: string): string[] {
    return this.toolchain.compileObject(sourcePath, objectPath, this.options);
  }
}

export class LldArgumentBuilder {
  constructor(private readonly toolchain: WasmToolchain = new BrowserEmscriptenToolchain()) {}

  build(objectPaths: string[], outputPath: string): string[] {
    return this.toolchain.link(objectPaths, outputPath);
  }
}
