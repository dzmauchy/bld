export class ObjectFile {
  constructor(
    readonly path: string,
    /** Absent when the file remains on a PROXYFS-shared `/work` directory. */
    readonly bytes?: Uint8Array,
  ) {}
}
