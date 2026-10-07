import { SharedToolchainFileSystem } from "./sharedFileSystem.ts";

export class ObjectFile {
  constructor(
    readonly path: string,
    private readonly files: SharedToolchainFileSystem,
  ) {}

  get bytes(): Uint8Array {
    return this.files.readFile(this.path);
  }

  /** JSON AST emitted alongside this object by clang-wasm. */
  get ast(): unknown {
    return JSON.parse(new TextDecoder().decode(this.files.readFile(this.path.replace(/\.o$/, ".json"))));
  }

  isStoredIn(files: SharedToolchainFileSystem): boolean {
    return this.files === files;
  }
}
