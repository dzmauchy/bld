import { joinPath, parentDir } from "./paths.ts";

export abstract class VirtualFileSystem {
  abstract mkdirTree(path: string): void;
  abstract writeFile(path: string, data: string | Uint8Array): void;
  abstract readFile(path: string): Uint8Array;
  abstract exists(path: string): boolean;
  abstract isDirectory(path: string): boolean;
  abstract list(path: string): string[];
  abstract unlink(path: string): void;
  abstract rmdir(path: string): void;
  abstract chdir(path: string): void;

  writeTree(path: string, data: string | Uint8Array): void {
    this.mkdirTree(parentDir(path));
    this.writeFile(path, data);
  }

  removeTree(path: string): void {
    if (!this.exists(path)) return;
    if (this.isDirectory(path)) {
      for (const name of this.list(path)) {
        if (name === "." || name === "..") continue;
        this.removeTree(joinPath(path, name));
      }
      if (path !== "/") this.rmdir(path);
      return;
    }
    this.unlink(path);
  }
}

export type EmscriptenFsApi = {
  mkdir(path: string): void;
  mkdirTree?(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  unlink(path: string): void;
  rmdir(path: string): void;
  chdir(path: string): void;
  analyzePath?(path: string): { exists: boolean };
  stat(path: string): { mode: number };
  isDir?(mode: number): boolean;
};

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { code?: string; errno?: number };
  return err.code === "ENOENT" || err.errno === 44;
}

function isExists(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { code?: string; errno?: number };
  return err.code === "EEXIST" || err.errno === 20;
}

export class EmscriptenFileSystem extends VirtualFileSystem {
  constructor(private readonly fs: EmscriptenFsApi) {
    super();
  }

  override mkdirTree(path: string): void {
    if (path === "/" || path === "") return;
    if (typeof this.fs.mkdirTree === "function") {
      this.fs.mkdirTree(path);
      return;
    }
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      try {
        this.fs.mkdir(current);
      } catch (error) {
        if (isExists(error) || (this.exists(current) && this.isDirectory(current))) continue;
        throw error;
      }
    }
  }

  override writeFile(path: string, data: string | Uint8Array): void {
    this.fs.writeFile(path, data);
  }

  override readFile(path: string): Uint8Array {
    const bytes = this.fs.readFile(path);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }

  override exists(path: string): boolean {
    if (typeof this.fs.analyzePath === "function") return this.fs.analyzePath(path).exists;
    try {
      this.fs.stat(path);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  override isDirectory(path: string): boolean {
    const stat = this.fs.stat(path);
    if (typeof this.fs.isDir === "function") return this.fs.isDir(stat.mode);
    return (stat.mode & 0o170000) === 0o040000;
  }

  override list(path: string): string[] {
    return this.fs.readdir(path);
  }

  override unlink(path: string): void {
    this.fs.unlink(path);
  }

  override rmdir(path: string): void {
    this.fs.rmdir(path);
  }

  override chdir(path: string): void {
    this.fs.chdir(path);
  }
}

export class MemoryFileSystem extends VirtualFileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly dirs = new Set<string>(["/"]);
  private cwd = "/";

  override mkdirTree(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      this.dirs.add(current);
    }
  }

  override writeFile(path: string, data: string | Uint8Array): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.files.set(path, bytes);
    this.mkdirTree(parentDir(path));
  }

  override readFile(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`file not found: ${path}`);
    return bytes;
  }

  override exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  override isDirectory(path: string): boolean {
    return this.dirs.has(path);
  }

  override list(path: string): string[] {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set<string>();
    for (const dir of this.dirs) {
      if (dir === path) continue;
      if (dir.startsWith(prefix) && !dir.slice(prefix.length).includes("/")) {
        names.add(dir.slice(prefix.length));
      }
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix) && !file.slice(prefix.length).includes("/")) {
        names.add(file.slice(prefix.length));
      }
    }
    return ["..", ".", ...names];
  }

  override unlink(path: string): void {
    this.files.delete(path);
  }

  override rmdir(path: string): void {
    this.dirs.delete(path);
  }

  override chdir(path: string): void {
    if (!this.isDirectory(path)) throw new Error(`not a directory: ${path}`);
    this.cwd = path;
  }

  get workingDirectory(): string {
    return this.cwd;
  }
}
