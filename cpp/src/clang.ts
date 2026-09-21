import { ClangArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import { ObjectFile } from "./object-file.ts";
import { isCppSource, objectPathFor, workPath } from "./paths.ts";

export class ClangFrontend extends EmscriptenTool {
  private args: ClangArgumentBuilder;

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
        for (const [name, text] of files) this.writeText(workPath(name), text);

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

  protected override onSysrootInstalled(resourceDir: string): void {
    this.args = this.args.withResourceDir(resourceDir);
  }
}
