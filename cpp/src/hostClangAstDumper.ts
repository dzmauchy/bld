/// <reference types="node" />
/**
 * @title Host Clang AST Dumper
 *
 * Node host for `clang++ -fsyntax-only -Xclang -ast-dump=json -fparse-all-comments`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PrecompiledHeaders } from "./precompiledHeaders.ts";
import { ClangAstDumper, ClangDumpResult } from "./clangAstDumper.ts";

export class HostClangAstDumper extends ClangAstDumper {
  private static instance: HostClangAstDumper | undefined;
  static get shared(): HostClangAstDumper {
    return (this.instance ??= new HostClangAstDumper());
  }

  private cached: { dir: string; headers: PrecompiledHeaders } | undefined;

  constructor(
    private readonly clangxx = "clang++",
    private readonly extraArgs: readonly string[] = HostClangAstDumper.detectStdlibArgs(),
  ) {
    super();
    process.once("exit", () => { if (this.cached) rmSync(this.cached.dir, { recursive: true, force: true }); });
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
    if (this.cached && !this.cached.headers.matches(files)) {
      rmSync(this.cached.dir, { recursive: true, force: true });
      this.cached = undefined;
    }
    const reused = Boolean(this.cached);
    const dir = this.cached?.dir ?? mkdtempSync(join(tmpdir(), "bld-clang-ast-"));
    try {
      const write = (name: string, text: string): void => {
        const path = join(dir, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      };
      for (const [name, text] of files) {
        if (!reused || !/\.(h|hpp|hh|hxx|inc)$/.test(name)) write(name, text);
      }
      const common = [
        "-std=c++23", "-fno-exceptions", "-fno-rtti", "-fno-color-diagnostics",
        "-fmessage-length=0", "-ferror-limit=0", "-fparse-all-comments",
        ...this.extraArgs, "-I", dir,
      ];
      const headers = this.cached?.headers ?? new PrecompiledHeaders(files);
      const pch = join(dir, "headers.pch");
      if (!headers.empty && !reused) {
        const includes = [...files.keys()].filter((name) => /\.(h|hpp|hh|hxx)$/.test(name)).sort();
        write("headers.hpp", includes.map((name) => `#include "${name}"`).join("\n"));
        const prepared = spawnSync(this.clangxx, [...common, "-x", "c++-header", join(dir, "headers.hpp"), "-o", pch], { encoding: "utf8" });
        if (prepared.status !== 0) return new ClangDumpResult(false, undefined, "", prepared.stderr ?? prepared.error?.message ?? "PCH failed");
        this.cached = { dir, headers };
      }
      const args = [
        ...common, ...(!headers.empty ? ["-include-pch", pch] : []),
        "-fsyntax-only", "-Xclang", "-ast-dump=json", join(dir, mainFile),
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
      if (this.cached?.dir !== dir) rmSync(dir, { recursive: true, force: true });
    }
  }
}

ClangAstDumper.register(HostClangAstDumper.shared);
