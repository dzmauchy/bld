import type { EmscriptenRuntime } from "./emscripten.ts";
import { EmscriptenFileSystem, type EmscriptenFsApi } from "./filesystem.ts";

const SHARED_DIRECTORIES = ["/work", "/pch"] as const;
const WORK_DIRECTORY = "/work";

function isAlreadyExists(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { code?: string; errno?: number };
  return err.code === "EEXIST" || err.errno === 20;
}

/**
 * Keeps `/work` and `/pch` on one clang module and mounts those directories
 * into later clang and lld modules with PROXYFS.
 */
export class ProxyWorkMount {
  private host: EmscriptenRuntime | undefined;
  private guests: EmscriptenRuntime[] = [];

  isHost(runtime: EmscriptenRuntime | undefined): boolean {
    return this.host !== undefined && this.host === runtime;
  }

  get retained(): boolean {
    return this.host !== undefined;
  }

  /** The first retained runtime owns `/work` and `/pch` until it is released. */
  retain(runtime: EmscriptenRuntime): void {
    if (this.host) return;
    for (const directory of SHARED_DIRECTORIES) this.ensureDirectory(runtime.FS, directory);
    this.host = runtime;
  }

  attach(runtime: EmscriptenRuntime): void {
    if (!this.host || this.host === runtime || this.guests.includes(runtime)) return;
    const mount = runtime.FS.mount;
    if (!runtime.PROXYFS || typeof mount !== "function") {
      throw new Error("emscripten module does not export PROXYFS");
    }
    for (const directory of SHARED_DIRECTORIES) {
      this.ensureDirectory(this.host.FS, directory);
      this.ensureDirectory(runtime.FS, directory);
      mount.call(runtime.FS, runtime.PROXYFS, { root: directory, fs: this.host.FS }, directory);
    }
    this.guests.push(runtime);
  }

  detach(runtime: EmscriptenRuntime): void {
    const index = this.guests.indexOf(runtime);
    if (index < 0) return;
    this.guests.splice(index, 1);
    this.unmount(runtime);
  }

  /** Drops guest mounts and deletes object files, leaving `/pch` on the host. */
  clearWorkFiles(): void {
    if (!this.host) return;
    const fs = new EmscriptenFileSystem(this.host.FS);
    if (fs.exists(WORK_DIRECTORY)) fs.removeTree(WORK_DIRECTORY);
    fs.mkdirTree(WORK_DIRECTORY);
  }

  detachGuests(): void {
    for (const guest of this.guests) this.unmount(guest);
    this.guests = [];
  }

  release(): void {
    this.detachGuests();
    this.host = undefined;
  }

  private ensureDirectory(fs: EmscriptenFsApi, path: string): void {
    if (typeof fs.mkdirTree === "function") {
      fs.mkdirTree(path);
      return;
    }
    try {
      fs.mkdir(path);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  private unmount(runtime: EmscriptenRuntime): void {
    if (typeof runtime.FS.unmount !== "function") return;
    for (const directory of SHARED_DIRECTORIES) {
      try {
        runtime.FS.unmount(directory);
      } catch {
        // The guest module may already have closed its filesystem.
      }
    }
  }
}
