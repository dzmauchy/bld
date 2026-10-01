import { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export class ObjectFile {
  constructor(
    readonly path: string,
    private readonly contents: Uint8Array | SharedToolchainFileSystem,
  ) {}

  get bytes(): Uint8Array {
    return this.contents instanceof SharedToolchainFileSystem ? this.contents.readFile(this.path) : this.contents;
  }

  isStoredIn(files: SharedToolchainFileSystem | undefined): boolean {
    return files !== undefined && this.contents === files;
  }
}
