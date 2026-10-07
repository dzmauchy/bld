/**
 * Browser host for the clang-wasm launcher’s JSON AST output.
 * Generated diagram sources and library headers are sent to the clang worker.
 */
import { BrowserCppRuntime } from "./browser/api.ts";
import { ClangAstDumper, ClangDumpResult } from "./clangAstDumper.ts";

export interface AstDumpClient {
  dumpAst(
    files: Map<string, string>,
    mainFile: string,
  ): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }>;
}

export class BrowserClangAstDumper extends ClangAstDumper {
  private static instance: BrowserClangAstDumper | undefined;

  constructor(private readonly compiler: AstDumpClient) {
    super();
  }

  static shared(): BrowserClangAstDumper {
    this.instance ??= new BrowserClangAstDumper({
      async dumpAst(files, mainFile) {
        const compiler = BrowserCppRuntime.shared().compiler;
        return compiler.dumpAst(files, mainFile);
      },
    });
    return this.instance;
  }

  override dump(): ClangDumpResult {
    throw new Error("Browser clang AST dumps run asynchronously");
  }

  override dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult> {
    return this.compiler.dumpAst(files, mainFile).then(
      (dump) => new ClangDumpResult(dump.ok, dump.ast, dump.stdout, dump.stderr),
    );
  }
}
