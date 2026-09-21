/**
 * @title Clang AST Dumper
 *
 * Invokes `clang++ -fsyntax-only -Xclang -ast-dump=json` and returns the dump.
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

  static register(dumper: ClangAstDumper): void {
    this.registered = dumper;
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
}
