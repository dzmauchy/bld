export type ClangCompileOptions = {
  resourceDir: string;
  std: string;
  optimize: string;
};

export class ClangArgumentBuilder {
  constructor(private readonly options: ClangCompileOptions = {
    resourceDir: "/sysroot/lib/clang/23",
    std: "c++23",
    optimize: "z",
  }) {}

  withResourceDir(resourceDir: string): ClangArgumentBuilder {
    return new ClangArgumentBuilder({ ...this.options, resourceDir });
  }

  syntaxOnlyAstDump(sourcePath: string, pchPath?: string): string[] {
    return [...this.common(pchPath), "-fsyntax-only", "-Xclang", "-ast-dump=json", sourcePath];
  }

  emitAst(sourcePath: string, pchPath?: string): string[] {
    return [...this.common(pchPath), "-fsyntax-only", "-Xclang", "-ast-dump", sourcePath];
  }

  precompile(headerPath: string, pchPath: string): string[] {
    return [
      ...this.common(), "-Xclang", "-fno-pch-timestamp",
      "-x", "c++-header", headerPath, "-o", pchPath,
    ];
  }

  build(sourcePath: string, objectPath: string, pchPath?: string): string[] {
    return [...this.common(pchPath), "-c", sourcePath, "-o", objectPath];
  }

  private common(pchPath?: string): string[] {
    return [
      "--target=wasm32-unknown-unknown",
      "--sysroot=/sysroot",
      "-stdlib=libc++", "-fvisibility=default",
      "-resource-dir", this.options.resourceDir,
      "-fno-exceptions", "-fno-rtti", "-fno-threadsafe-statics",
      `-std=${this.options.std}`, `-O${this.options.optimize}`,
      "-fno-color-diagnostics", "-fmessage-length=0", "-ferror-limit=0",
      "-fparse-all-comments", "-I/work",
      ...(pchPath ? ["-include-pch", pchPath] : []),
    ];
  }
}

export class LldArgumentBuilder {
  constructor(private readonly resourceDir = "/sysroot/lib/clang/23") {}

  withResourceDir(resourceDir: string): LldArgumentBuilder {
    return new LldArgumentBuilder(resourceDir);
  }

  build(objectPaths: string[], outputPath: string): string[] {
    const lib = "/sysroot/lib";
    return [
      "-flavor",
      "wasm",
      "--no-entry",
      "--export-dynamic",
      "--export=__wasm_call_ctors",
      "--export-table",
      "--export-memory",
      "--stack-first",
      "-z",
      "stack-size=1048576",
      "-L",
      lib,
      "-L",
      `${lib}/wasm32-unknown-unknown`,
      "-L",
      `${this.resourceDir}/lib/wasi`,
      ...objectPaths,
      "-lbrowser",
      "-lc++",
      "-lc++abi",
      "-lc",
      "-lm",
      "-lclang_rt.builtins-wasm32",
      "-o",
      outputPath,
    ];
  }
}
