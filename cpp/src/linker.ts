import { LldArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import type { ObjectFile } from "./object-file.ts";
import type { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export class WasmLinker extends EmscriptenTool {
  constructor(
    createModule: EmscriptenModuleFactory,
    wasmUrl: string,
    sharedFiles: SharedToolchainFileSystem,
    private readonly args = new LldArgumentBuilder(),
  ) {
    super(createModule, "wasm-ld", wasmUrl, sharedFiles);
  }

  async link(objects: ObjectFile[], outputPath = "/work/a.wasm"): Promise<Uint8Array> {
    try {
      return await this.runJob(async () => {
        if (objects.length === 0) throw new Error("no object files to link");
        this.prepareWork();
        for (const object of objects) {
          if (!object.isStoredIn(this.sharedFileSystem)) throw new Error("object files must belong to the linker shared filesystem");
        }
        await this.runMainAsync(this.args.build(objects.map((object) => object.path), outputPath));
        return this.readCopy(outputPath);
      });
    } finally {
      await this.recycle();
    }
  }
}
