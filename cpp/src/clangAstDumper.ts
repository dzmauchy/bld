/**
 * Host and browser implementations of C++23 JSON AST dumps.
 * Named auto declarations provide types; diagnostics report invalid connections.
 * Comments are retained for diagram C++ import/export.
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

export interface ClangAstDumper {
  dump(files: Map<string, string>, mainFile: string): ClangDumpResult;
  dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult>;
}

/** Selects the concrete host or browser dumper used by diagram analysis. */
export const ClangAstDumper = new class {
  private registered: ClangAstDumper | undefined;
  libraryFiles: Record<string, string> = {};

  register(dumper: ClangAstDumper, libraryFiles: Record<string, string> = {}): void {
    this.registered = dumper;
    if (Object.keys(libraryFiles).length > 0) this.bindLibraryFiles(libraryFiles);
  }

  bindLibraryFiles(libraryFiles: Record<string, string>): void {
    this.libraryFiles = libraryFiles;
  }

  defaultDumper(): ClangAstDumper {
    if (!this.registered) throw new Error("No ClangAstDumper registered. In Node, import cpp/hostClangAstDumper.ts");
    return this.registered;
  }
}();
