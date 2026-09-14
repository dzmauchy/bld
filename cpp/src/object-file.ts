export class ObjectFile {
  constructor(
    readonly path: string,
    readonly bytes: Uint8Array,
  ) {}
}
