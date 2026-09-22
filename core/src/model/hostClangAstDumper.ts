/**
 * @title Host Clang AST Dumper
 *
 * Node host for `clang++ -fsyntax-only -Xclang -ast-dump=json -fparse-all-comments`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nativeLibraryFiles } from "base";
import { ClangAstDumper, ClangDumpResult } from "./clangAstDumper";

export class HostClangAstDumper extends ClangAstDumper {
  private static instance: HostClangAstDumper | undefined;
  static get shared(): HostClangAstDumper {
    return (this.instance ??= new HostClangAstDumper());
  }

  constructor(
    private readonly clangxx = "clang++",
    private readonly extraArgs: readonly string[] = HostClangAstDumper.detectStdlibArgs(),
  ) {
    super();
  }

  static detectStdlibArgs(): string[] {
    const gccRoot = "/usr/lib/gcc/x86_64-linux-gnu";
    for (const version of ["13", "12", "11", "14", "15"]) {
      const installDir = join(gccRoot, version);
      const cxxHeader = join("/usr/include/c++", version, "initializer_list");
      if (existsSync(installDir) && existsSync(cxxHeader)) {
        return [`--gcc-install-dir=${installDir}`];
      }
    }
    return [];
  }

  override dump(files: Map<string, string>, mainFile: string): ClangDumpResult {
    const dir = mkdtempSync(join(tmpdir(), "bld-clang-ast-"));
    try {
      for (const [name, text] of files) {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      }
      const args = [
        "-fsyntax-only",
        "-Xclang",
        "-ast-dump=json",
        "-std=c++20",
        "-fno-exceptions",
        "-fno-rtti",
        "-fno-color-diagnostics",
        "-fparse-all-comments",
        ...this.extraArgs,
        "-I",
        dir,
        join(dir, mainFile),
      ];
      const spawned = spawnSync(this.clangxx, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const stdout = spawned.stdout ?? "";
      const stderr = spawned.stderr ?? spawned.error?.message ?? "";
      let ast: unknown;
      try {
        ast = JSON.parse(stdout);
      } catch {
        ast = undefined;
      }
      return new ClangDumpResult(spawned.status === 0, ast, stdout, stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

ClangAstDumper.register(HostClangAstDumper.shared, nativeLibraryFiles());
