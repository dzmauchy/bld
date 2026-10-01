import { LldArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import type { ObjectFile } from "./object-file.ts";
import type { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export class WasmLinker extends EmscriptenTool {
  constructor(
    createModule: EmscriptenModuleFactory,
    wasmUrl: string,
    private readonly args: LldArgumentBuilder = new LldArgumentBuilder(),
    sharedFiles?: SharedToolchainFileSystem,
  ) {
    super(createModule, "wasm-ld", wasmUrl, sharedFiles);
  }

  async link(objects: ObjectFile[], outputPath = "/work/a.wasm"): Promise<Uint8Array> {
    try {
      return await this.runJob(async () => {
        if (objects.length === 0) throw new Error("no object files to link");
        this.prepareWork();
        for (const object of objects) {
          if (!object.isStoredIn(this.sharedFileSystem)) this.writeBytes(object.path, object.bytes);
        }
        await this.runMainAsync(this.args.build(objects.map((object) => object.path), outputPath));
        return this.readCopy(outputPath);
      });
    } finally {
      await this.recycle();
    }
  }
}
