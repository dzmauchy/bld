import { expect } from "@rstest/core";
import type { EmscriptenModuleFactory, EmscriptenModuleOptions } from "../src/emscripten.ts";
import { MemoryFileSystem, type EmscriptenFsApi } from "../src/filesystem.ts";
import { SharedToolchainFileSystem } from "../src/sharedFileSystem.ts";

/** Models fresh tool filesystems mounting one owner, with one invocation per runtime. */
export class DisposableToolFactory {
  private created = 0;
  readonly runs: string[][] = [];

  constructor(
    private readonly owner: SharedToolchainFileSystem,
    private readonly invoke: (options: EmscriptenModuleOptions | undefined, fs: SharedToolchainFileSystem, args: string[]) => number,
  ) {}

  get boots(): number { return this.created; }

  readonly create: EmscriptenModuleFactory = async (options) => {
    this.created++;
    const local = new MemoryFileSystem();
    const mounted = new Map<string, SharedToolchainFileSystem>();
    const files = (path: string) => mounted.get(`/${path.split("/")[1]}`) ?? local;
    const api: EmscriptenFsApi = {
      mkdir: (path) => files(path).mkdirTree(path),
      mkdirTree: (path) => files(path).mkdirTree(path),
      writeFile: (path, data) => files(path).writeFile(path, data),
      readFile: (path) => files(path).readFile(path),
      readdir: (path) => files(path).list(path),
      unlink: (path) => files(path).unlink(path),
      rmdir: (path) => files(path).rmdir(path),
      chdir: (path) => files(path).chdir(path),
      analyzePath: (path) => ({ exists: files(path).exists(path) }),
      isDir: (mode) => (mode & 0o170000) === 0o040000,
      stat: (path) => ({ mode: files(path).isDirectory(path) ? 0o040000 : 0o100000 }),
      mount: (_type, { root, fs }, path) => {
        expect(root).toBe(path);
        expect(fs).toBe(this.owner);
        mounted.set(path, fs as SharedToolchainFileSystem);
      },
    };
    let invoked = false;
    return {
      FS: api,
      PROXYFS: {},
      callMain: (args) => {
        expect(invoked, "clang/lld entry points must never be reused").toBe(false);
        invoked = true;
        this.runs.push(args);
        expect([...mounted.keys()]).toEqual([...SharedToolchainFileSystem.mountPaths]);
        return this.invoke(options, this.owner, args);
      },
    };
  };
}

/** Writes the launcher’s paired outputs for each translation unit. */
export function writeClangOutputs(
  fs: SharedToolchainFileSystem,
  args: string[],
  bytes = new Uint8Array([42]),
  ast: unknown = { kind: "TranslationUnitDecl" },
): void {
  expect(args.slice(0, 3)).toEqual(["-dump", "--output-dir", "/work/build"]);
  for (const source of args.slice(3)) {
    const stem = source.slice(source.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
    fs.writeTree(`/work/build/${stem}.o`, bytes);
    fs.writeTree(`/work/build/${stem}.json`, JSON.stringify(ast));
  }
}
