const wasmMagic = Object.freeze([0x00, 0x61, 0x73, 0x6d]);

/**
 * Workers static assets recompress a body when `_headers` sets
 * `Content-Encoding: br` on bytes that are already Brotli. The browser
 * unwraps one layer and `WebAssembly.compile` then fails the magic check.
 * Precompressed `.wasm` responses must leave the worker with `encodeBody: "manual"`.
 */
export class PrecompressedWasmDelivery {
  isWasmModule(prefix: Uint8Array): boolean {
    if (prefix.length < wasmMagic.length) return false;
    return wasmMagic.every((byte, index) => prefix[index] === byte);
  }

  shouldServeAsBrotli(pathname: string, status: number, prefix: Uint8Array): boolean {
    if (status !== 200 || !pathname.endsWith(".wasm")) return false;
    if (prefix.length > 0 && prefix[0] === 0x3c) return false;
    return !this.isWasmModule(prefix);
  }

  brotliHeaders(source: Headers): Headers {
    const headers = new Headers(source);
    headers.set("Content-Encoding", "br");
    headers.set("Content-Type", "application/wasm");
    headers.set("Cache-Control", "public, max-age=0, must-revalidate, no-transform");
    return headers;
  }

  async splitPrefix(
    body: ReadableStream<Uint8Array>,
    size = wasmMagic.length,
  ): Promise<{ prefix: Uint8Array; stream: ReadableStream<Uint8Array> }> {
    const reader = body.getReader();
    const buffered: Uint8Array[] = [];
    let got = 0;
    while (got < size) {
      const next = await reader.read();
      if (next.done || !next.value) break;
      buffered.push(next.value);
      got += next.value.byteLength;
    }
    const prefix = new Uint8Array(Math.min(size, got));
    let offset = 0;
    for (const chunk of buffered) {
      if (offset >= prefix.length) break;
      const take = Math.min(chunk.byteLength, prefix.length - offset);
      prefix.set(chunk.subarray(0, take), offset);
      offset += take;
    }
    const pending = buffered;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = pending.shift();
        if (chunk) {
          controller.enqueue(chunk);
          return;
        }
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
    return { prefix, stream };
  }
}
