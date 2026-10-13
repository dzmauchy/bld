/** Minimal ustar writer for test inputs; production only needs extraction. */
export function packTar(entries: readonly {
  header: { name: string; size: number; type?: string };
  body: string | Uint8Array;
}[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const bodies = entries.map((entry) => typeof entry.body === "string" ? encoder.encode(entry.body) : entry.body);
  const bytes = new Uint8Array(1024 + bodies.reduce((size, body) => size + 512 + Math.ceil(body.length / 512) * 512, 0));
  let offset = 0;
  for (let i = 0; i < entries.length; i++) {
    const { header } = entries[i];
    const body = bodies[i];
    if (encoder.encode(header.name).length > 100 || header.size !== body.length) throw new Error("Invalid tar test fixture");
    const block = bytes.subarray(offset, offset + 512);
    block.set(encoder.encode(header.name));
    block.set(encoder.encode("0000644\0"), 100);
    block.set(encoder.encode("0000000\0"), 108);
    block.set(encoder.encode("0000000\0"), 116);
    block.set(encoder.encode(body.length.toString(8).padStart(11, "0") + "\0"), 124);
    block.set(encoder.encode("00000000000\0"), 136);
    block.fill(32, 148, 156);
    block[156] = (header.type ?? "0").charCodeAt(0);
    block.set(encoder.encode("ustar\0"), 257);
    block.set(encoder.encode("00"), 263);
    const checksum = block.reduce((sum, byte) => sum + byte, 0);
    block.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);
    bytes.set(body, offset + 512);
    offset += 512 + Math.ceil(body.length / 512) * 512;
  }
  return bytes;
}
