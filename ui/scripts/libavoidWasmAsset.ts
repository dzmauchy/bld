/** Converts the packaged router's legacy Wasm exceptions to standard try_table instructions. */
export class LibavoidWasmAsset {
  async transform(input: Buffer): Promise<Buffer> {
    const { default: binaryen } = await import("binaryen");
    const module = binaryen.readBinary(input);
    try {
      // libavoid-js omits target_features. Enable its mutable globals and sign
      // extensions, plus the reference and block types used by standard Wasm EH.
      module.setFeatures(module.getFeatures()
        | binaryen.Features.MutableGlobals
        | binaryen.Features.SignExt
        | binaryen.Features.ExceptionHandling
        | binaryen.Features.ReferenceTypes
        | binaryen.Features.Multivalue);
      module.runPasses(["translate-to-exnref"]);
      if (!module.validate()) throw new Error("Invalid libavoid Wasm after converting exception instructions");
      return Buffer.from(module.emitBinary());
    } finally {
      module.dispose();
    }
  }
}
