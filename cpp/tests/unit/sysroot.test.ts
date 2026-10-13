import { describe, expect, test } from "vitest";
import { shouldInstallSysrootEntry, tarPathToMemfs } from "cpp/sysroot.ts";

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
});
