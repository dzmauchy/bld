/**
 * Browser host for `clang++ -fsyntax-only -Xclang -ast-dump=json`.
 * Library headers are sent to the in-browser clang worker; comments are read
 * from the dumped AST, not scanned out of the header text.
 */
import { ClangAstDumper, ClangDumpResult } from "core";
import { WorkerCppWasmCompiler, wrapEventTargetWorker } from "cpp";

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
    this.instance ??= new BrowserClangAstDumper(
      new WorkerCppWasmCompiler(wrapEventTargetWorker(createCompilerWorker())),
    );
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

function createCompilerWorker(): Worker {
  return new Worker(new URL("../../../cpp/src/workers/compiler.worker.ts", import.meta.url), { type: "module" });
}
