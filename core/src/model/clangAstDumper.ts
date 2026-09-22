/**
 * @title Clang AST Dumper
 *
 * Invokes `clang++ -fsyntax-only -Xclang -ast-dump=json -fparse-all-comments`
 * and returns the dump. Comments ride the AST as FullComment nodes, so header
 * and diagram metadata needs no separate C++ parser.
 * Host (Node) and wasm dumpers register themselves against this contract.
 */
export class ClangDumpResult {
  constructor(
    readonly ok: boolean,
    readonly ast: unknown,
    readonly stdout: string,
    readonly stderr: string,
  ) {}

  get diagnostics(): string {
    return this.stderr;
  }

  get hasTypeError(): boolean {
    return (
      /error:/.test(this.stderr) &&
      /cannot initialize|incompatible|no viable|no matching|cannot convert|cannot bind/i.test(this.stderr)
    );
  }
}

export abstract class ClangAstDumper {
  private static registered: ClangAstDumper | undefined;
  static libraryFiles: Record<string, string> = {};

  static register(dumper: ClangAstDumper, libraryFiles: Record<string, string> = {}): void {
    this.registered = dumper;
    if (Object.keys(libraryFiles).length > 0) this.libraryFiles = libraryFiles;
  }

  static defaultDumper(): ClangAstDumper {
    if (!this.registered) {
      throw new Error(
        "No ClangAstDumper registered. In Node, import HostClangAstDumper to run clang++ -fsyntax-only -Xclang -ast-dump=json",
      );
    }
    return this.registered;
  }

  abstract dump(files: Map<string, string>, mainFile: string): ClangDumpResult;

  dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult> {
    return Promise.resolve(this.dump(files, mainFile));
  }
}
