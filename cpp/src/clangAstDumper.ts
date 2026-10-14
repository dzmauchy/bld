/**
 * Asynchronous C++23 JSON AST dumps from the Wasm toolchain.
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

/** Contract and registration for the Wasm dumper used by diagram analysis. */
export abstract class ClangAstDumper {
  private static registered: ClangAstDumper | undefined;
  private static files: Readonly<Record<string, string>> = Object.freeze({});

  static get libraryFiles(): Readonly<Record<string, string>> { return this.files; }

  static register(dumper: ClangAstDumper, libraryFiles: Record<string, string> = {}): void {
    this.registered = dumper;
    if (Object.keys(libraryFiles).length > 0) this.bindLibraryFiles(libraryFiles);
  }

  static bindLibraryFiles(libraryFiles: Record<string, string>): void {
    this.files = Object.freeze({ ...libraryFiles });
  }

  static defaultDumper(): ClangAstDumper {
    if (!this.registered) throw new Error("No ClangAstDumper registered. Register a Wasm compiler-backed dumper before analyzing diagrams.");
    return this.registered;
  }

  abstract dumpAsync(files: Map<string, string>, mainFile: string): Promise<ClangDumpResult>;
}
