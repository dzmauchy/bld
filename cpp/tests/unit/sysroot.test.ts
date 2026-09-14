import { packTar } from "modern-tar";
import { describe, expect, test } from "vitest";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { shouldInstallSysrootEntry, SysrootInstaller, tarPathToMemfs } from "../../src/sysroot.ts";

describe("sysroot entry filter", () => {
  test("installs headers and clang resource files into the clang filesystem", () => {
    expect(shouldInstallSysrootEntry("sysroot/include/stdint.h", "headers")).toBe(true);
    expect(shouldInstallSysrootEntry("sysroot/lib/clang/23/include/stddef.h", "headers")).toBe(true);
    expect(shouldInstallSysrootEntry("sysroot/lib/wasm32-emscripten/libc.a", "headers")).toBe(false);
  });

  test("installs static libraries into the lld filesystem", () => {
    expect(shouldInstallSysrootEntry("sysroot/lib/wasm32-emscripten/libc.a", "libraries")).toBe(true);
    expect(shouldInstallSysrootEntry("sysroot/lib/wasm32-emscripten/crt1_reactor.o", "libraries")).toBe(true);
    expect(shouldInstallSysrootEntry("sysroot/include/stdio.h", "libraries")).toBe(false);
  });

  test("maps tar names onto the emscripten absolute FS", () => {
    expect(tarPathToMemfs("sysroot/include/foo.h")).toBe("/sysroot/include/foo.h");
  });
});

describe("SysrootInstaller", () => {
  test("writes filtered header entries into a virtual filesystem", async () => {
    const tar = await packTar([
      { header: { name: "sysroot/include/foo.h", size: 5 }, body: "hello" },
      { header: { name: "sysroot/lib/wasm32-emscripten/libc.a", size: 3 }, body: "lib" },
    ]);
    const fs = new MemoryFileSystem();
    const installer = new SysrootInstaller(fs);
    const result = await installer.install(tar, "headers", false);
    expect(result.files).toBe(1);
    expect(new TextDecoder().decode(fs.readFile("/sysroot/include/foo.h"))).toBe("hello");
    expect(fs.exists("/sysroot/lib/wasm32-emscripten/libc.a")).toBe(false);
  });

  test("writes filtered library entries into a virtual filesystem", async () => {
    const tar = await packTar([
      { header: { name: "sysroot/include/foo.h", size: 5 }, body: "hello" },
      { header: { name: "sysroot/lib/wasm32-emscripten/libc.a", size: 3 }, body: "lib" },
    ]);
    const fs = new MemoryFileSystem();
    const installer = new SysrootInstaller(fs);
    const result = await installer.install(tar, "libraries", false);
    expect(result.files).toBe(1);
    expect(new TextDecoder().decode(fs.readFile("/sysroot/lib/wasm32-emscripten/libc.a"))).toBe("lib");
    expect(fs.exists("/sysroot/include/foo.h")).toBe(false);
  });
});
