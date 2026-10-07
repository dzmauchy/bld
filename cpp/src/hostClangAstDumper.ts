/// <reference types="node" />
/**
 * @title Host Clang AST Dumper
 *
 * Node host for `clang++ -fsyntax-only -Xclang -ast-dump=json -fparse-all-comments`.
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ClangAstReader } from "./clangAstReader.ts";
import { ClangAstDumper, ClangDumpResult } from "./clangAstDumper.ts";

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
      const write = (name: string, text: string): void => {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      };
      for (const [name, text] of files) {
        write(name, text);
      }
      const common = [
        "-std=c++23", "-fno-exceptions", "-fno-rtti", "-fno-color-diagnostics",
        "-fmessage-length=0", "-ferror-limit=0", "-fparse-all-comments",
        ...this.extraArgs, "-I", dir,
      ];
      const args = [
        ...common, "-fsyntax-only", "-Xclang", "-ast-dump=json", join(dir, mainFile),
      ];
      const output = openSync(join(dir, "ast.json"), "w+");
      try {
        const spawned = spawnSync(this.clangxx, args, { encoding: "utf8", stdio: ["ignore", output, "pipe"] });
        let stderr = [spawned.stderr, spawned.error?.message].filter(Boolean).join("\n");
        let ast: unknown;
        try {
          const reader = new ClangAstReader(mainFile);
          const chunk = new Uint8Array(64 * 1024);
          let position = 0;
          let count: number;
          while ((count = readSync(output, chunk, 0, chunk.length, position)) > 0) {
            reader.read(chunk.subarray(0, count));
            position += count;
          }
          ast = reader.finish();
        } catch (error) {
          stderr = [stderr, String(error)].filter(Boolean).join("\n");
        }
        return new ClangDumpResult(spawned.status === 0 && ast !== undefined, ast, "", stderr);
      } finally {
        closeSync(output);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

ClangAstDumper.register(HostClangAstDumper.shared);
