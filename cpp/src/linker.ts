import { LldArgumentBuilder } from "./args.ts";
import { EmscriptenTool, type EmscriptenModuleFactory } from "./emscripten.ts";
import type { ObjectFile } from "./object-file.ts";
import type { ProxyWorkMount } from "./proxyWorkMount.ts";

export class WasmLinker extends EmscriptenTool {
  constructor(
    createModule: EmscriptenModuleFactory,
    wasmUrl: string,
    private readonly args: LldArgumentBuilder = new LldArgumentBuilder(),
    workMount?: ProxyWorkMount,
  ) {
    super(createModule, "wasm-ld", wasmUrl, workMount);
  }

  async link(objects: ObjectFile[], outputPath = "/work/a.wasm"): Promise<Uint8Array> {
    try {
      return await this.runJob(async () => {
        if (objects.length === 0) throw new Error("no object files to link");
        this.prepareWork();
        this.attachSharedWork();
        for (const object of objects) {
          if (this.fileExists(object.path)) continue;
          if (object.bytes === undefined) throw new Error(`missing object file ${object.path}`);
          this.writeBytes(object.path, object.bytes);
        }
        await this.runMainAsync(this.args.build(objects.map((object) => object.path), outputPath));
        return this.readCopy(outputPath);
      });
    } finally {
      if (!this.workMount) await this.recycle();
    }
  }
}
