export type TarInput = ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
export interface TarFile {
  readonly name: string;
  /** A view into the decompressed archive. */
  readonly data: Uint8Array;
}

type ExtendedHeader = { path?: string; size?: string };

const BLOCK_SIZE = 512;
const decoder = new TextDecoder();

/** Native gzip decompression followed by a linear tar scan. File data is a view. */
export class TarArchive {
  private readonly bytes: Uint8Array;

  constructor(bytes: ArrayBuffer | Uint8Array) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  static async read(input: TarInput, compressed = true): Promise<TarArchive> {
    if (!compressed && !(input instanceof ReadableStream)) return new TarArchive(input);
    const stream = input instanceof ReadableStream ? input : new ReadableStream({
      start(controller) {
        controller.enqueue(input instanceof Uint8Array ? input : new Uint8Array(input));
        controller.close();
      },
    });
    const source = compressed ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
    return new TarArchive(await new Response(source).arrayBuffer());
  }

  *files(): Generator<TarFile> {
    const bytes = this.bytes;
    if (bytes.length < BLOCK_SIZE) throw new Error("Truncated tar header");
    const global: ExtendedHeader = {};
    let pending: ExtendedHeader = {};
    for (let offset = 0; offset < bytes.length;) {
      if (offset + BLOCK_SIZE > bytes.length) throw new Error("Truncated tar header");
      const header = bytes.subarray(offset, offset + BLOCK_SIZE);
      if (header.every((byte) => byte === 0)) return;
      let checksum = 0;
      for (let i = 0; i < BLOCK_SIZE; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
      if (checksum !== octal(header.subarray(148, 156))) throw new Error("Invalid tar checksum");
      const type = header[156];
      // x/g: PAX metadata; L/K: GNU long names; 0/NUL: regular files.
      const extension = type === 120 || type === 103 || type === 76 || type === 75;
      const declaredSize = extension ? undefined : pending.size ?? global.size;
      const size = declaredSize === undefined ? tarSize(header.subarray(124, 136)) : Number(declaredSize);
      const start = offset + BLOCK_SIZE;
      const end = start + size;
      offset = start + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
      if (!Number.isSafeInteger(size) || size < 0 || end > bytes.length || offset > bytes.length) {
        throw new Error("Invalid or truncated tar entry");
      }
      if (type === 120 || type === 103) {
        readPax(bytes.subarray(start, end), type === 103 ? global : pending);
      } else if (type === 76) {
        pending.path = text(bytes.subarray(start, end));
      } else if (type !== 75) {
        if (type === 0 || type === 48) {
          const prefix = text(header.subarray(257, 263)) === "ustar" ? text(header.subarray(345, 500)) : "";
          const name = pending.path ?? global.path ?? (prefix ? `${prefix}/` : "") + text(header.subarray(0, 100));
          yield { name, data: bytes.subarray(start, end) };
        }
        pending = {};
      }
    }
  }
}

function text(bytes: Uint8Array): string {
  const zero = bytes.indexOf(0);
  return decoder.decode(zero < 0 ? bytes : bytes.subarray(0, zero));
}

function octal(bytes: Uint8Array): number {
  const value = text(bytes).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar number");
  return Number.parseInt(value, 8);
}

function tarSize(bytes: Uint8Array): number {
  if (!(bytes[0] & 128)) return octal(bytes);
  let value = bytes[0] & 127;
  for (let i = 1; i < bytes.length; i++) value = value * 256 + bytes[i];
  return value;
}

function readPax(bytes: Uint8Array, fields: ExtendedHeader): void {
  for (let offset = 0; offset < bytes.length;) {
    const space = bytes.indexOf(32, offset);
    const length = Number(decoder.decode(bytes.subarray(offset, space)));
    const end = offset + length;
    if (space < offset || !Number.isSafeInteger(length) || length <= space - offset + 1
      || end > bytes.length || bytes[end - 1] !== 10) throw new Error("Invalid tar extended header");
    const record = decoder.decode(bytes.subarray(space + 1, end - 1));
    const equals = record.indexOf("=");
    if (equals < 1) throw new Error("Invalid tar extended header");
    const key = record.slice(0, equals);
    if (key === "path" || key === "size") fields[key] = record.slice(equals + 1);
    offset = end;
  }
}
