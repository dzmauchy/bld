export type ClangCompileOptions = {
  resourceDir: string;
  std: string;
  optimize: string;
};

export class ClangArgumentBuilder {
  constructor(private readonly options: ClangCompileOptions = {
    resourceDir: "/sysroot/lib/clang/23",
    std: "c++20",
    optimize: "2",
  }) {}

  withResourceDir(resourceDir: string): ClangArgumentBuilder {
    return new ClangArgumentBuilder({ ...this.options, resourceDir });
  }

  build(sourcePath: string, objectPath: string): string[] {
    return [
      "--target=wasm32-unknown-emscripten",
      "--sysroot=/sysroot",
      "-resource-dir",
      this.options.resourceDir,
      "-fno-exceptions",
      "-fno-rtti",
      `-std=${this.options.std}`,
      `-O${this.options.optimize}`,
      "-fno-color-diagnostics",
      "-I/work",
      "-c",
      sourcePath,
      "-o",
      objectPath,
    ];
  }
}

export class LldArgumentBuilder {
  build(objectPaths: string[], outputPath: string): string[] {
    const lib = "/sysroot/lib/wasm32-emscripten";
    return [
      "-flavor",
      "wasm",
      "--no-entry",
      "--export-all",
      "--export-table",
      "--allow-undefined",
      "--stack-first",
      "-z",
      "stack-size=1048576",
      "-L",
      lib,
      ...objectPaths,
      `${lib}/crt1_reactor.o`,
      "-lc++-noexcept",
      "-lc++abi-noexcept",
      "-lclang_rt.builtins",
      "-ldlmalloc",
      "-lc",
      "-lstubs",
      "-lstandalonewasm",
      "-lnoexit",
      "-o",
      outputPath,
    ];
  }
}
