import type { EmscriptenFsApi } from "./filesystem.ts";
import type { EmscriptenRuntime } from "./emscripten.ts";

const WORK_DIRECTORY = "/work";

function isAlreadyExists(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { code?: string; errno?: number };
  return err.code === "EEXIST" || err.errno === 20;
}

/**
 * Keeps `/work` on the clang module that wrote the object files and mounts
 * that directory into later clang and lld modules with PROXYFS.
 */
export class ProxyWorkMount {
  private host: EmscriptenRuntime | undefined;
  private guests: EmscriptenRuntime[] = [];

  isHost(runtime: EmscriptenRuntime | undefined): boolean {
    return this.host !== undefined && this.host === runtime;
  }

  /** The first retained runtime owns `/work` for the rest of this compile. */
  retain(runtime: EmscriptenRuntime): void {
    if (this.host) return;
    this.ensureDirectory(runtime.FS);
    this.host = runtime;
  }

  attach(runtime: EmscriptenRuntime): void {
    if (!this.host || this.host === runtime || this.guests.includes(runtime)) return;
    const mount = runtime.FS.mount;
    if (!runtime.PROXYFS || typeof mount !== "function") {
      throw new Error("emscripten module does not export PROXYFS");
    }
    this.ensureDirectory(this.host.FS);
    this.ensureDirectory(runtime.FS);
    mount.call(runtime.FS, runtime.PROXYFS, { root: WORK_DIRECTORY, fs: this.host.FS }, WORK_DIRECTORY);
    this.guests.push(runtime);
  }

  detach(runtime: EmscriptenRuntime): void {
    const index = this.guests.indexOf(runtime);
    if (index < 0) return;
    this.guests.splice(index, 1);
    this.unmount(runtime);
  }

  release(): void {
    for (const guest of this.guests) this.unmount(guest);
    this.guests = [];
    this.host = undefined;
  }

  private ensureDirectory(fs: EmscriptenFsApi): void {
    if (typeof fs.mkdirTree === "function") {
      fs.mkdirTree(WORK_DIRECTORY);
      return;
    }
    try {
      fs.mkdir(WORK_DIRECTORY);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }

  private unmount(runtime: EmscriptenRuntime): void {
    if (typeof runtime.FS.unmount !== "function") return;
    try {
      runtime.FS.unmount(WORK_DIRECTORY);
    } catch {
      // The guest module may already have closed its filesystem.
    }
  }
}
