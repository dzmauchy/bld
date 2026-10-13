export type TarInput = ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;

export interface TarFile {
  readonly name: string;
  /** A view into the decompressed archive, without copying the file body. */
  readonly data: Uint8Array;
}

export class TarArchive {
  constructor(bytes: ArrayBuffer | Uint8Array);
  static read(input: TarInput, compressed?: boolean): Promise<TarArchive>;
  files(): Generator<TarFile>;
}
