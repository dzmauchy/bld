import { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export class ObjectFile {
  constructor(
    readonly path: string,
    private readonly files: SharedToolchainFileSystem,
  ) {}

  get bytes(): Uint8Array {
    return this.files.readFile(this.path);
  }

  isStoredIn(files: SharedToolchainFileSystem): boolean {
    return this.files === files;
  }
}
