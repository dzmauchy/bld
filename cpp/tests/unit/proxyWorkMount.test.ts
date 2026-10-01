import { describe, expect, test } from "@rstest/core";
import type { EmscriptenRuntime } from "../../src/emscripten.ts";
import { MemoryFileSystem, type EmscriptenFsApi } from "../../src/filesystem.ts";
import { ProxyWorkMount } from "../../src/proxyWorkMount.ts";

function runtime(options: {
  mount?: NonNullable<EmscriptenFsApi["mount"]>;
  unmount?: NonNullable<EmscriptenFsApi["unmount"]>;
  proxy?: object;
} = {}): EmscriptenRuntime {
  const fs: EmscriptenFsApi = {
    mkdir: () => {},
    mkdirTree: () => {},
    writeFile: () => {},
    readFile: () => new Uint8Array(),
    readdir: () => [],
    unlink: () => {},
    rmdir: () => {},
    chdir: () => {},
    stat: () => ({ mode: 0o040000 }),
  };
  if (options.mount) fs.mount = options.mount;
  if (options.unmount) fs.unmount = options.unmount;
  const moduleRuntime: EmscriptenRuntime = { FS: fs, callMain: () => 0 };
  if (options.proxy) moduleRuntime.PROXYFS = options.proxy;
  return moduleRuntime;
}

describe("ProxyWorkMount", () => {
  test("mounts the retained work and precompiled-header directories with the guest PROXYFS", () => {
    const mount = new ProxyWorkMount();
    const host = runtime();
    const proxy = { kind: "PROXYFS" };
    const mounted: { type: object; root: string; fs: EmscriptenFsApi; mountpoint: string }[] = [];
    const guest = runtime({
      proxy,
      mount: (type, opts, mountpoint) => {
        mounted.push({ type, root: opts.root, fs: opts.fs, mountpoint });
      },
    });

    mount.retain(host);
    mount.attach(host);
    mount.attach(guest);
    mount.attach(guest);

    expect(mounted).toEqual([
      { type: proxy, root: "/work", fs: host.FS, mountpoint: "/work" },
      { type: proxy, root: "/pch", fs: host.FS, mountpoint: "/pch" },
    ]);
  });

  test("rejects a guest that does not export PROXYFS", () => {
    const mount = new ProxyWorkMount();
    mount.retain(runtime());
    expect(() => mount.attach(runtime())).toThrow(/PROXYFS/);
  });

  test("releases the host and unmounts guests before the next compile", () => {
    const mount = new ProxyWorkMount();
    const unmounted: string[] = [];
    const proxy = {};
    const mountCalls: EmscriptenFsApi[] = [];
    const guest = runtime({
      proxy,
      mount: (_type, opts) => {
        mountCalls.push(opts.fs);
      },
      unmount: (mountpoint) => {
        unmounted.push(mountpoint);
      },
    });
    const first = runtime();
    const second = runtime();

    mount.retain(first);
    mount.attach(guest);
    mount.release();
    mount.retain(second);
    mount.attach(guest);

    expect(unmounted).toEqual(["/work", "/pch"]);
    expect(mountCalls).toEqual([first.FS, first.FS, second.FS, second.FS]);
    expect(mount.isHost(first)).toBe(false);
    expect(mount.isHost(second)).toBe(true);
  });

  test("clears object files and leaves the precompiled header on the retained host", () => {
    const mount = new ProxyWorkMount();
    const files = new MemoryFileSystem();
    const host: EmscriptenRuntime = {
      FS: {
        mkdir: (path) => files.mkdirTree(path),
        mkdirTree: (path) => files.mkdirTree(path),
        writeFile: (path, data) => files.writeFile(path, data),
        readFile: (path) => files.readFile(path),
        readdir: (path) => files.list(path),
        unlink: (path) => files.unlink(path),
        rmdir: (path) => files.rmdir(path),
        chdir: (path) => files.chdir(path),
        analyzePath: (path) => ({ exists: files.exists(path) }),
        stat: (path) => ({ mode: files.isDirectory(path) ? 0o040000 : 0o100000 }),
        isDir: (mode) => (mode & 0o170000) === 0o040000,
      },
      callMain: () => 0,
    };
    mount.retain(host);
    files.writeFile("/work/a.o", new Uint8Array([1]));
    files.writeFile("/pch/headers.pch", new Uint8Array([9]));

    mount.clearWorkFiles();

    expect(mount.retained).toBe(true);
    expect(files.exists("/work")).toBe(true);
    expect(files.exists("/work/a.o")).toBe(false);
    expect(files.readFile("/pch/headers.pch")).toEqual(new Uint8Array([9]));
  });
});
