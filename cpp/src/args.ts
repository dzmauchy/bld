/** Options accepted by the custom clang-wasm launcher. Compiler defaults are built in. */
export class ClangArgumentBuilder {
  build(sourcePaths: string[], outputDir = "/work/build"): string[] {
    return ["-o", outputDir, ...sourcePaths];
  }
}

export class LldArgumentBuilder {
  build(objectPaths: string[], outputPath: string): string[] {
    return [
      "--no-entry",
      "--export-dynamic",
      "--export=wasm_initialize",
      "--export-table",
      "--export-memory",
      "--stack-first",
      "-z",
      "stack-size=1048576",
      "-L",
      "/sysroot/lib",
      ...objectPaths,
      "-lbrowser",
      "-o",
      outputPath,
    ];
  }
}
