import { ClangArgumentBuilder } from "./args.ts";
import { DiagramMetaCommentFilter } from "./commentFilter.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import { ObjectFile } from "./object-file.ts";
import { PrecompiledHeaders } from "./precompiledHeaders.ts";
import { isCppSource, isHeader, objectPathFor, workPath } from "./paths.ts";

export class ClangFrontend extends EmscriptenTool {
  private args: ClangArgumentBuilder;
  private headers: PrecompiledHeaders | undefined;
  private usePrecompiledHeaders = false;
  private readonly comments = new DiagramMetaCommentFilter();

  constructor(
    createModule: EmscriptenModuleFactory,
    wasmUrl: string,
    args: ClangArgumentBuilder = new ClangArgumentBuilder(),
  ) {
    super(createModule, "clang++", wasmUrl);
    this.args = args;
  }

  async compile(files: Map<string, string>): Promise<ObjectFile[]> {
    try {
      return await this.runJob(async () => {
        const sources = [...files.keys()].filter((name) => isCppSource(name));
        if (sources.length === 0) throw new Error("no C or C++ source files to compile");

        const objects: ObjectFile[] = [];
        for (const source of sources) {
          if (objects.length > 0) await this.recycle();
          const pch = await this.prepareFiles(files, true);
          const objectPath = objectPathFor(source);
          await this.runMainAsync(this.args.build(workPath(source), objectPath, pch));
          objects.push(new ObjectFile(objectPath, this.readCopy(objectPath)));
        }
        return objects;
      });
    } finally {
      await this.recycle();
    }
  }

  async dumpAst(files: Map<string, string>, mainFile: string): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    try {
      return await this.runJob(async () => {
        const pch = await this.prepareFiles(files);
        const captured = this.runMainCapture(this.args.syntaxOnlyAstDump(workPath(mainFile), pch));
        let ast: unknown;
        try {
          ast = JSON.parse(captured.stdout);
        } catch {
          ast = undefined;
        }
        return {
          ok: captured.code === 0,
          ast,
          stdout: ast === undefined ? captured.stdout : "",
          stderr: captured.stderr,
        };
      });
    } finally {
      await this.recycle();
    }
  }

  async emitAst(files: Map<string, string>, mainFile: string): Promise<{ ok: boolean; astText: string; stdout: string; stderr: string }> {
    try {
      return await this.runJob(async () => {
        const pch = await this.prepareFiles(files);
        const captured = this.runMainCapture(this.args.emitAst(workPath(mainFile), pch));
        return { ok: captured.code === 0, astText: captured.stdout, stdout: captured.stdout, stderr: captured.stderr };
      });
    } finally {
      await this.recycle();
    }
  }

  /** Prepares a shared bundle of guarded headers for subsequent AST and compile jobs. */
  async precompileHeaders(files: Map<string, string>): Promise<void> {
    this.usePrecompiledHeaders = true;
    if (this.headers?.matches(files)) return;
    try {
      await this.runJob(() => this.prepareFiles(files));
    } finally {
      await this.recycle();
    }
  }

  private async prepareFiles(files: Map<string, string>, stripMetadata = false): Promise<string | undefined> {
    this.prepareWork();
    if (this.usePrecompiledHeaders && !this.headers?.matches(files)) {
      this.headers = undefined;
      const headers = new PrecompiledHeaders(files);
      if (!headers.empty) {
        // Headers and PCH paths stay identical across disposable tool instances.
        headers.restore(this);
        await this.runMainAsync(this.args.precompile(PrecompiledHeaders.headerPath, PrecompiledHeaders.outputPath));
        headers.capture(PrecompiledHeaders.outputPath, this.readCopy(PrecompiledHeaders.outputPath));
        this.headers = headers;
        await this.recycle();
      }
    }
    this.headers?.restore(this);
    for (const [name, text] of files) {
      this.writeText(workPath(name), stripMetadata && !isHeader(name) ? this.comments.apply(text) : text);
    }
    return this.headers ? PrecompiledHeaders.outputPath : undefined;
  }

  protected override onSysrootInstalled(resourceDir: string): void {
    this.args = this.args.withResourceDir(resourceDir);
  }
}
