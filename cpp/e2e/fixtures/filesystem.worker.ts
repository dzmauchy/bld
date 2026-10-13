import { loadEmscriptenModule } from "cpp/emscripten.ts";
import { SharedToolchainFileSystem } from "cpp/sharedFileSystem.ts";
import { SysrootInstaller } from "cpp/sysroot.ts";
import type { EmscriptenRuntime } from "cpp/emscripten.ts";

export interface FilesystemTrial {
  scriptUrl: string;
  wasmUrl: string;
  archives: { bytes: Uint8Array; compressed: boolean }[];
  paths: string[];
  excluded: string[];
  shared: boolean;
}

export interface FilesystemResult {
  installed: number[];
  files: Record<string, Uint8Array>;
  excluded: Record<string, boolean>;
  missingParentRejected: boolean;
  freshRuntime?: boolean;
  error?: string;
}

function mount(runtime: EmscriptenRuntime, owner: SharedToolchainFileSystem): void {
  for (const path of SharedToolchainFileSystem.mountPaths) {
    runtime.FS.mkdirTree(path);
    runtime.FS.mount(runtime.PROXYFS, { root: path, fs: owner }, path);
  }
}

globalThis.onmessage = async (event: MessageEvent<FilesystemTrial>) => {
  try {
    const trial = event.data;
    const factory = await loadEmscriptenModule(trial.scriptUrl, trial.wasmUrl);
    let runtime = await factory({ noInitialRun: true });
    const owner = trial.shared ? new SharedToolchainFileSystem() : undefined;
    if (owner) mount(runtime, owner);
    const installed: number[] = [];
    for (const archive of trial.archives) {
      installed.push(await new SysrootInstaller(runtime.FS).install(archive.bytes, archive.compressed));
    }
    let freshRuntime: boolean | undefined;
    if (owner) {
      const previous = runtime;
      runtime = await factory({ noInitialRun: true });
      freshRuntime = runtime.FS !== previous.FS && trial.paths.every(path => !runtime.FS.analyzePath(path).exists);
      mount(runtime, owner);
    }
    const FS = runtime.FS;
    let missingParentRejected = false;
    try { FS.writeFile("/missing-parent/file", new Uint8Array([1])); }
    catch { missingParentRejected = true; }
    const result: FilesystemResult = {
      installed,
      files: Object.fromEntries(trial.paths.map(path => [path, FS.readFile(path)])),
      excluded: Object.fromEntries(trial.excluded.map(path => [path, FS.analyzePath(path).exists])),
      missingParentRejected,
      ...(freshRuntime === undefined ? {} : { freshRuntime }),
    };
    globalThis.postMessage(result);
  } catch (error) {
    globalThis.postMessage({ error: String(error) });
  }
};
