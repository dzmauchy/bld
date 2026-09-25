/**
 * Inflates gzip bytes with the platform DecompressionStream.
 * Release wasm assets and the sysroot archive are stored gzip-compressed.
 */
export class GzipDecoder {
  async inflate(source: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
    const input = source instanceof ReadableStream ? source : new Blob([copyBytes(source)]).stream();
    const decompressor = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    return new Uint8Array(await new Response(input.pipeThrough(decompressor)).arrayBuffer());
  }
}

function copyBytes(archive: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const source = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
