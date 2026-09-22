export type ClangCompileOptions = {
  resourceDir: string;
  std: string;
  optimize: string;
};

export const defaultClangOptions: ClangCompileOptions = {
  resourceDir: "/sysroot/lib/clang/23",
  std: "c++23",
  optimize: "2",
};

/**
 * One wasm compilation target: a clang triple plus the link recipe for that embedder.
 * Browser diagrams use the Emscripten sysroot. MCU stays a freestanding triple with no link yet.
 */
export abstract class WasmToolchain {
  abstract readonly profile: "browser" | "mcu";
  abstract readonly triple: string;

  syntaxOnlyAstDump(sourcePath: string, options: ClangCompileOptions): string[] {
    return this.frontend(sourcePath, options, [
      "-fparse-all-comments",
      "-fsyntax-only",
      "-Xclang",
      "-ast-dump=json",
    ]);
  }

  emitAst(sourcePath: string, options: ClangCompileOptions): string[] {
    return this.frontend(sourcePath, options, [
      "-fparse-all-comments",
      "-fsyntax-only",
      "-Xclang",
      "-ast-dump",
    ]);
  }

  compileObject(sourcePath: string, objectPath: string, options: ClangCompileOptions): string[] {
    return [
      ...this.frontendFlags(options),
      `-O${options.optimize}`,
      "-c",
      sourcePath,
      "-o",
      objectPath,
    ];
  }

  abstract link(objectPaths: string[], outputPath: string): string[];

  private frontend(sourcePath: string, options: ClangCompileOptions, extra: string[]): string[] {
    return [...this.frontendFlags(options), ...extra, sourcePath];
  }

  private frontendFlags(options: ClangCompileOptions): string[] {
    return [
      `--target=${this.triple}`,
      "--sysroot=/sysroot",
      "-resource-dir",
      options.resourceDir,
      "-fno-exceptions",
      "-fno-rtti",
      "-fno-threadsafe-statics",
      `-std=${options.std}`,
      "-fno-color-diagnostics",
      "-I/work",
    ];
  }
}

/**
 * Browser diagrams. Clang targets `wasm32-unknown-emscripten`, which matches
 * `lib/wasm32-emscripten` in the sysroot. wasm-ld links the standalone
 * Emscripten runtime and places an 8 MiB stack at the start of linear memory.
 */
export class BrowserEmscriptenToolchain extends WasmToolchain {
  readonly profile = "browser" as const;
  readonly triple = "wasm32-unknown-emscripten";
  readonly stackBytes = 8 * 1024 * 1024;

  link(objectPaths: string[], outputPath: string): string[] {
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
      `stack-size=${this.stackBytes}`,
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

/**
 * MCU diagrams. The freestanding triple is reserved here; producing a binary is not implemented.
 */
export class McuUnknownToolchain extends WasmToolchain {
  readonly profile = "mcu" as const;
  readonly triple = "wasm32-unknown-unknown";

  link(_objectPaths: string[], _outputPath: string): string[] {
    throw new Error("MCU wasm profile is not implemented");
  }
}
