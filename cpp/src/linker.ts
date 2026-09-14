import { LldArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import type { ObjectFile } from "./object-file.ts";

export class WasmLinker extends EmscriptenTool {
  constructor(
    createModule: EmscriptenModuleFactory,
    private readonly args: LldArgumentBuilder = new LldArgumentBuilder(),
  ) {
    super(createModule, "wasm-ld");
  }

  async link(objects: ObjectFile[], outputPath = "/work/a.wasm"): Promise<Uint8Array> {
    return this.runJob(async () => {
      if (objects.length === 0) throw new Error("no object files to link");
      this.prepareWork();
      for (const object of objects) this.writeBytes(object.path, object.bytes);
      await this.runMainAsync(this.args.build(objects.map((object) => object.path), outputPath));
      return this.readCopy(outputPath);
    });
  }
}
