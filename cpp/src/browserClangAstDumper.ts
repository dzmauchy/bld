/**
 * Browser host for the clang-wasm launcher’s JSON AST output.
 * Generated diagram sources and library headers are sent to the clang worker.
 */
import { BrowserCppRuntime } from "./browser/api.ts";
import { ClangDumpResult } from "./clangAstDumper.ts";

export class BrowserClangAstDumper {
  private static instance: BrowserClangAstDumper | undefined;

  static shared(): BrowserClangAstDumper {
    return this.instance ??= new BrowserClangAstDumper();
  }

  dump(): ClangDumpResult {
    throw new Error("Browser clang AST dumps run asynchronously");
  }

  async dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult> {
    const dump = await BrowserCppRuntime.shared().compiler.dumpAst(files, mainFile);
    return new ClangDumpResult(dump.ok, dump.ast, dump.stdout, dump.stderr);
  }
}
