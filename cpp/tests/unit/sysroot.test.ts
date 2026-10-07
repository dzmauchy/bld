import { packTar } from "modern-tar";
import { describe, expect, test } from "@rstest/core";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { shouldInstallSysrootEntry, SysrootInstaller, tarPathToMemfs } from "../../src/sysroot.ts";

describe("shared sysroot install", () => {
  test("selects runtime headers, Clang resources and static libraries", () => {
    for (const name of ["sysroot/include/wasm.hpp", "./sysroot/lib/clang/23/include/stddef.h", "sysroot/lib/libbrowser.a"]) {
      expect(shouldInstallSysrootEntry(name)).toBe(true);
    }
    for (const name of ["sysroot/", "sysroot/share/licenses/TLSF-LICENSE.txt", "sysroot/../escape.a", "other/include/test.h"]) {
      expect(shouldInstallSysrootEntry(name)).toBe(false);
    }
    expect(tarPathToMemfs("./sysroot/include/wasm.hpp")).toBe("/sysroot/include/wasm.hpp");
  });

  test("writes headers and libraries together into the persistent filesystem", async () => {
    const tar = await packTar([
      { header: { name: "sysroot/include/foo.h", size: 5 }, body: "hello" },
      { header: { name: "sysroot/lib/libwasm.a", size: 3 }, body: "lib" },
      { header: { name: "sysroot/share/licenses/TLSF-LICENSE.txt", size: 7 }, body: "license" },
    ]);
    const fs = new MemoryFileSystem();
    expect(await new SysrootInstaller(fs).install(tar, false)).toBe(2);
    expect(new TextDecoder().decode(fs.readFile("/sysroot/include/foo.h"))).toBe("hello");
    expect(new TextDecoder().decode(fs.readFile("/sysroot/lib/libwasm.a"))).toBe("lib");
    expect(fs.exists("/sysroot/share/licenses/TLSF-LICENSE.txt")).toBe(false);
  });
});
