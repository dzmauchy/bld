import { describe, expect, test } from "@rstest/core";
import type { EmscriptenRuntime } from "../../src/emscripten.ts";
import type { EmscriptenFsApi } from "../../src/filesystem.ts";
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
  test("mounts the retained work directory with the guest PROXYFS", () => {
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

    expect(mounted).toEqual([{ type: proxy, root: "/work", fs: host.FS, mountpoint: "/work" }]);
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

    expect(unmounted).toEqual(["/work"]);
    expect(mountCalls).toEqual([first.FS, second.FS]);
    expect(mount.isHost(first)).toBe(false);
    expect(mount.isHost(second)).toBe(true);
  });
});