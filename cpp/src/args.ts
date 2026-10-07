/** Options accepted by the custom clang-wasm launcher. Compiler defaults are built in. */
export class ClangArgumentBuilder {
  build(sourcePaths: string[], outputDir = "/work/build"): string[] {
    return ["-dump", "--output-dir", outputDir, ...sourcePaths];
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
