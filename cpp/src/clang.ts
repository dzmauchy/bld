import { ClangArgumentBuilder } from "./args.ts";
import { DiagramMetaCommentFilter } from "./commentFilter.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import { ObjectFile } from "./object-file.ts";
import { isCppSource, objectPathFor, workPath } from "./paths.ts";

export class ClangFrontend extends EmscriptenTool {
  private args: ClangArgumentBuilder;
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

        this.prepareWork();
        for (const [name, text] of files) this.writeText(workPath(name), this.comments.apply(text));

        const objects: ObjectFile[] = [];
        for (const source of sources) {
          const objectPath = objectPathFor(source);
          await this.runMainAsync(this.args.build(workPath(source), objectPath));
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
        this.prepareWork();
        for (const [name, text] of files) this.writeText(workPath(name), text);
        const captured = this.runMainCapture(this.args.syntaxOnlyAstDump(workPath(mainFile)));
        let ast: unknown;
        try {
          ast = JSON.parse(captured.stdout);
        } catch {
          ast = undefined;
        }
        return { ok: captured.code === 0, ast, stdout: captured.stdout, stderr: captured.stderr };
      });
    } finally {
      await this.recycle();
    }
  }

  async emitAst(files: Map<string, string>, mainFile: string): Promise<{ ok: boolean; astText: string; stdout: string; stderr: string }> {
    try {
      return await this.runJob(async () => {
        this.prepareWork();
        for (const [name, text] of files) this.writeText(workPath(name), text);
        const captured = this.runMainCapture(this.args.emitAst(workPath(mainFile)));
        return { ok: captured.code === 0, astText: captured.stdout, stdout: captured.stdout, stderr: captured.stderr };
      });
    } finally {
      await this.recycle();
    }
  }

  protected override onSysrootInstalled(resourceDir: string): void {
    this.args = this.args.withResourceDir(resourceDir);
  }
}
