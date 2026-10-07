import { VirtualFileSystem } from "./filesystem.ts";
import { parentDir, workPath } from "./paths.ts";

function fsError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

abstract class SharedNode {
  private timestamp = Date.now();
  private permissions: number;

  constructor(readonly inode: number, mode: number) { this.permissions = mode; }

  abstract get size(): number;
  get mode(): number { return this.permissions; }

  chmod(mode: number): void {
    this.permissions = (this.permissions & 0o170000) | (mode & 0o7777);
  }

  touch(): void {
    this.timestamp = Date.now();
  }

  setTime(time: number): void {
    this.timestamp = time;
  }

  stat() {
    return {
      dev: 1, ino: this.inode, mode: this.mode, nlink: 1, uid: 0, gid: 0,
      rdev: 0, size: this.size, blksize: 4096, blocks: Math.ceil(this.size / 4096),
      atime: new Date(this.timestamp), mtime: new Date(this.timestamp), ctime: new Date(this.timestamp),
    };
  }
}

class SharedDirectory extends SharedNode {
  private readonly children = new Map<string, SharedNode>();

  constructor(inode: number) {
    super(inode, 0o040777);
  }

  override get size(): number { return 4096; }
  get empty(): boolean { return this.children.size === 0; }
  get(name: string): SharedNode | undefined { return this.children.get(name); }
  names(): string[] { return [...this.children.keys()]; }

  set(name: string, node: SharedNode): void {
    this.children.set(name, node);
    this.touch();
  }

  delete(name: string): void {
    this.children.delete(name);
    this.touch();
  }
}

class SharedFile extends SharedNode {
  private contents = new Uint8Array(0);
  private length = 0;
  private sourceText: string | undefined;

  constructor(inode: number) {
    super(inode, 0o100666);
  }

  override get size(): number { return this.length; }

  replace(data: string | Uint8Array): void {
    // Preserve header timestamps and avoid encoding/copying unchanged library inputs.
    if (typeof data === "string" && data === this.sourceText) return;
    this.contents = typeof data === "string" ? new TextEncoder().encode(data) : data.slice();
    this.length = this.contents.length;
    this.sourceText = typeof data === "string" ? data : undefined;
    this.touch();
  }

  copy(): Uint8Array { return this.contents.slice(0, this.length); }

  read(buffer: Uint8Array, offset: number, length: number, position: number): number {
    const count = Math.min(length, Math.max(0, this.length - position));
    buffer.set(this.contents.subarray(position, position + count), offset);
    return count;
  }

  write(buffer: Uint8Array, offset: number, length: number, position: number): number {
    const end = position + length;
    this.reserve(end);
    if (position > this.length) this.contents.fill(0, this.length, position);
    this.contents.set(buffer.subarray(offset, offset + length), position);
    this.length = Math.max(this.length, end);
    this.sourceText = undefined;
    this.touch();
    return length;
  }

  truncate(length: number): void {
    this.reserve(length);
    if (length > this.length) this.contents.fill(0, this.length, length);
    this.length = length;
    this.sourceText = undefined;
    this.touch();
  }

  private reserve(length: number): void {
    if (length <= this.contents.length) return;
    const bytes = new Uint8Array(Math.max(length, 256, this.contents.length * 2));
    bytes.set(this.contents.subarray(0, this.length));
    this.contents = bytes;
  }
}

class SharedSymlink extends SharedNode {
  constructor(inode: number, readonly target: string) {
    super(inode, 0o120777);
  }
  override get size(): number { return this.target.length; }
}

/** An opaque open handle passed back by Emscripten's PROXYFS stream operations. */
class SharedStream {
  private position = 0;
  private closed = false;

  constructor(private readonly node: SharedNode, private readonly flags: number) {}

  close(): void { this.closed = true; }

  read(buffer: Uint8Array, offset: number, length: number, position?: number): number {
    if ((this.flags & 3) === 1) fsError("EBADF");
    const count = this.file().read(buffer, offset, length, position ?? this.position);
    if (position === undefined) this.position += count;
    return count;
  }

  write(buffer: Uint8Array, offset: number, length: number, position?: number): number {
    if ((this.flags & 3) === 0) fsError("EBADF");
    const file = this.file();
    const start = (this.flags & 1024) ? file.size : position ?? this.position;
    const count = file.write(buffer, offset, length, start);
    if (position === undefined) this.position = start + count;
    return count;
  }

  private file(): SharedFile {
    if (this.closed) fsError("EBADF");
    if (!(this.node instanceof SharedFile)) fsError("EISDIR");
    return this.node;
  }
}

/**
 * Worker-owned storage implementing the synchronous owner API used by PROXYFS.
 * It retains no clang/lld runtime or Wasm heap. Fresh tool instances mount the
 * same directories, so sysroot, JSON dumps and object files survive tool disposal.
 */
export class SharedToolchainFileSystem extends VirtualFileSystem {
  static readonly mountPaths = ["/sysroot", "/work"] as const;
  private nextInode = 1;
  private readonly root = new SharedDirectory(this.nextInode++);

  constructor() {
    super();
    for (const path of SharedToolchainFileSystem.mountPaths) this.mkdirTree(path);
  }

  /** Drops removed inputs and old outputs while preserving unchanged headers. */
  prepareInputs(files: ReadonlyMap<string, string>): void {
    const paths = new Set([...files.keys()].map(workPath));
    this.prune("/work", paths);
    for (const [name, text] of files) this.writeTree(workPath(name), text);
  }

  override mkdirTree(path: string): void {
    let current = "";
    for (const part of this.normalize(path).split("/").filter(Boolean)) {
      current += `/${part}`;
      if (!this.exists(current)) this.mkdir(current);
      else if (!this.isDirectory(current)) fsError("ENOTDIR");
    }
  }

  mkdir(path: string, mode = 0o777): void {
    const [parent, name] = this.parent(path);
    if (parent.get(name)) fsError("EEXIST");
    const node = new SharedDirectory(this.nextInode++);
    node.chmod(mode);
    parent.set(name, node);
  }

  override writeFile(path: string, data: string | Uint8Array): void {
    const [parent, name] = this.parent(path);
    let node = parent.get(name);
    if (!node) {
      node = new SharedFile(this.nextInode++);
      parent.set(name, node);
    }
    if (!(node instanceof SharedFile)) fsError("EISDIR");
    node.replace(data);
  }

  override readFile(path: string): Uint8Array {
    const node = this.lookup(path);
    if (!(node instanceof SharedFile)) fsError("EISDIR");
    return node.copy();
  }

  override exists(path: string): boolean {
    try { this.lookup(path); return true; }
    catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw error;
    }
  }

  override isDirectory(path: string): boolean { return this.lookup(path) instanceof SharedDirectory; }
  override list(path: string): string[] { return this.readdir(path); }

  readdir(path: string): string[] {
    const node = this.lookup(path);
    if (!(node instanceof SharedDirectory)) fsError("ENOTDIR");
    return [".", "..", ...node.names()];
  }

  override unlink(path: string): void {
    const [parent, name] = this.parent(path);
    const node = parent.get(name);
    if (!node) fsError("ENOENT");
    if (node instanceof SharedDirectory) fsError("EISDIR");
    parent.delete(name);
  }

  override rmdir(path: string): void {
    const [parent, name] = this.parent(path);
    const node = parent.get(name);
    if (!node) fsError("ENOENT");
    if (!(node instanceof SharedDirectory)) fsError("ENOTDIR");
    if (!node.empty) fsError("ENOTEMPTY");
    parent.delete(name);
  }

  override chdir(path: string): void {
    if (!this.isDirectory(path)) fsError("ENOTDIR");
  }

  stat(path: string) { return this.lookup(path).stat(); }
  lstat(path: string) { return this.lookup(path, false).stat(); }

  chmod(path: string, mode: number): void {
    this.lookup(path).chmod(mode);
  }

  utime(path: string, _atime: number | Date, mtime: number | Date): void {
    this.lookup(path).setTime(Number(mtime));
  }

  truncate(path: string, length: number): void {
    if (length < 0) fsError("EINVAL");
    const node = this.lookup(path);
    if (!(node instanceof SharedFile)) fsError("EISDIR");
    node.truncate(length);
  }

  rename(oldPath: string, newPath: string): void {
    oldPath = this.normalize(oldPath);
    newPath = this.normalize(newPath);
    if (oldPath === newPath) return;
    if (newPath.startsWith(`${oldPath}/`)) fsError("EINVAL");
    const [oldParent, oldName] = this.parent(oldPath);
    const node = oldParent.get(oldName);
    if (!node) fsError("ENOENT");
    const [newParent, newName] = this.parent(newPath);
    const target = newParent.get(newName);
    if (target instanceof SharedDirectory) {
      if (!(node instanceof SharedDirectory)) fsError("EISDIR");
      if (!target.empty) fsError("ENOTEMPTY");
    } else if (target && node instanceof SharedDirectory) fsError("ENOTDIR");
    newParent.set(newName, node);
    oldParent.delete(oldName);
  }

  symlink(target: string, path: string): void {
    const [parent, name] = this.parent(path);
    if (parent.get(name)) fsError("EEXIST");
    parent.set(name, new SharedSymlink(this.nextInode++, target));
  }

  readlink(path: string): string {
    const node = this.lookup(path, false);
    if (!(node instanceof SharedSymlink)) fsError("EINVAL");
    return node.target;
  }

  open(path: string, flags: number): SharedStream {
    if (!this.exists(path)) {
      if (!(flags & 64)) fsError("ENOENT");
      this.writeFile(path, new Uint8Array(0));
    } else if ((flags & 64) && (flags & 128)) fsError("EEXIST");
    const node = this.lookup(path);
    if ((flags & 65536) && !(node instanceof SharedDirectory)) fsError("ENOTDIR");
    if (node instanceof SharedDirectory && (flags & 3)) fsError("EISDIR");
    if ((flags & 512) && node instanceof SharedFile) node.truncate(0);
    return new SharedStream(node, flags);
  }

  close(stream: SharedStream): void { stream.close(); }
  read(stream: SharedStream, buffer: Uint8Array, offset: number, length: number, position?: number): number {
    return stream.read(buffer, offset, length, position);
  }
  write(stream: SharedStream, buffer: Uint8Array, offset: number, length: number, position?: number): number {
    return stream.write(buffer, offset, length, position);
  }

  private prune(path: string, inputs: ReadonlySet<string>): void {
    for (const name of this.readdir(path)) {
      if (name === "." || name === "..") continue;
      const child = `${path}/${name}`;
      if (this.isDirectory(child)) {
        this.prune(child, inputs);
        if (this.readdir(child).length === 2) this.rmdir(child);
      } else if (!inputs.has(child)) this.unlink(child);
    }
  }

  private normalize(path: string): string {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    return `/${parts.join("/")}`;
  }

  private lookup(path: string, follow = true, depth = 0): SharedNode {
    if (depth > 40) fsError("ELOOP");
    const parts = this.normalize(path).split("/").filter(Boolean);
    let node: SharedNode = this.root;
    for (let index = 0; index < parts.length; index++) {
      if (!(node instanceof SharedDirectory)) fsError("ENOTDIR");
      node = node.get(parts[index]) ?? fsError("ENOENT");
      if (node instanceof SharedSymlink && (follow || index < parts.length - 1)) {
        const base = `/${parts.slice(0, index).join("/")}`;
        const target = node.target.startsWith("/") ? node.target : `${base}/${node.target}`;
        return this.lookup(`${target}/${parts.slice(index + 1).join("/")}`, follow, depth + 1);
      }
    }
    return node;
  }

  private parent(path: string): [SharedDirectory, string] {
    path = this.normalize(path);
    if (path === "/") fsError("EBUSY");
    const node = this.lookup(parentDir(path));
    if (!(node instanceof SharedDirectory)) fsError("ENOTDIR");
    return [node, path.slice(path.lastIndexOf("/") + 1)];
  }
}
