/** A BufferSource view for compilation, preserving subarray boundaries. */
export function toWasmBytes(wasm: Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  if (wasm instanceof ArrayBuffer) return new Uint8Array(wasm);
  if (wasm.buffer instanceof ArrayBuffer) return new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength);
  return wasm.slice();
}
