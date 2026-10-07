import { ClangArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import { ObjectFile } from "./object-file.ts";
import { astPathFor, isCppSource, objectPathFor, workPath } from "./paths.ts";
import type { SharedToolchainFileSystem } from "./sharedFileSystem.ts";
import { DiagramMetaCommentFilter } from "./commentFilter.ts";

export class ClangFrontend extends EmscriptenTool {
  private cachedInputs: ReadonlyMap<string, string> | undefined;
  private readonly cachedSources = new Map<string, { code: number; stdout: string; stderr: string }>();

  constructor(
    createModule: EmscriptenModuleFactory,
    wasmUrl: string,
    sharedFiles: SharedToolchainFileSystem,
    private readonly args = new ClangArgumentBuilder(),
  ) {
    super(createModule, "clang", wasmUrl, sharedFiles);
  }

  /** Emits JSON ASTs and objects in one launcher invocation, reusing a prior successful dump. */
  async compile(files: Map<string, string>): Promise<ObjectFile[]> {
    try {
      const sources = [...files.keys()].filter(isCppSource);
      if (sources.length === 0) throw new Error("no C or C++ source files to compile");
      this.validateOutputs(sources);
      this.prepareInputs(files, true);
      const pending = sources.filter((source) => !this.cachedSources.has(source));
      if (pending.length > 0) {
        await this.runJob(async () => {
          await this.ensureReady();
          this.prepareWork();
          await this.runMainAsync(this.args.build(pending.map(workPath)));
          for (const source of pending) this.cachedSources.set(source, { code: 0, ...this.logs });
        });
      }
      return sources.map((source) => new ObjectFile(objectPathFor(source), this.sharedFileSystem));
    } catch (error) {
      this.invalidate();
      throw error;
    } finally {
      await this.recycle();
    }
  }

  async dumpAst(files: Map<string, string>, mainFile: string): Promise<{ ok: boolean; ast: unknown; stdout: string; stderr: string }> {
    try {
      this.prepareInputs(files);
      let captured = this.cachedSources.get(mainFile) ?? { code: 0, stdout: "", stderr: "" };
      if (!this.cachedSources.has(mainFile)) {
        captured = await this.runJob(async () => {
          await this.ensureReady();
          this.prepareWork();
          return this.runMainCapture(this.args.build([workPath(mainFile)]));
        });
      }
      let ast: unknown;
      const path = astPathFor(mainFile);
      if (this.sharedFileSystem.exists(path)) {
        try {
          ast = JSON.parse(new TextDecoder().decode(this.readCopy(path)));
        } catch (error) {
          captured.stderr = [captured.stderr, `Failed to parse ${path} (${this.sharedFileSystem.stat(path).size} bytes): ${String(error)}`].filter(Boolean).join("\n");
          ast = undefined;
        }
      }
      if (captured.code === 0 && ast !== undefined && this.sharedFileSystem.exists(objectPathFor(mainFile))) {
        this.cachedSources.set(mainFile, captured);
      } else {
        this.invalidate();
      }
      return { ok: captured.code === 0 && ast !== undefined, ast, stdout: captured.stdout, stderr: captured.stderr };
    } catch (error) {
      this.invalidate();
      throw error;
    } finally {
      await this.recycle();
    }
  }

  private prepareInputs(files: ReadonlyMap<string, string>, ignoreDiagramMetadata = false): void {
    const filter = new DiagramMetaCommentFilter();
    if (this.cachedInputs?.size === files.size && [...files].every(([name, text]) => {
      const cached = this.cachedInputs?.get(name);
      return cached === text || (ignoreDiagramMetadata && isCppSource(name) && cached !== undefined
        && filter.apply(cached) === filter.apply(text));
    })) return;
    this.invalidate();
    this.sharedFileSystem.prepareInputs(files);
    this.cachedInputs = new Map(files);
  }

  private invalidate(): void {
    this.cachedInputs = undefined;
    this.cachedSources.clear();
  }

  private validateOutputs(sources: string[]): void {
    const outputs = new Set<string>();
    for (const source of sources) {
      const path = objectPathFor(source);
      if (outputs.has(path)) throw new Error(`input files map to the same output: ${path}`);
      outputs.add(path);
    }
  }
}
