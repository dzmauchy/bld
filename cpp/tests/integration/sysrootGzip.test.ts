import { packTar } from "modern-tar";
import { describe, expect, test } from "@rstest/core";
import { MemoryFileSystem } from "../../src/filesystem.ts";
import { SysrootInstaller } from "../../src/sysroot.ts";

describe("gzipped sysroot install", () => {
  test("decodes a tar.gz archive with modern-tar before writing the FS", async () => {
    const tar = await packTar([
      { header: { name: "sysroot/include/wasm.hpp", size: 4 }, body: "wasm" },
      { header: { name: "sysroot/lib/clang/23/include/stddef.h", size: 4 }, body: "size" },
      { header: { name: "sysroot/lib/libwasm.a", size: 3 }, body: "c++" },
    ]);
    const compressed = await new Response(
      new Blob([tar]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const fs = new MemoryFileSystem();
    const installer = new SysrootInstaller(fs);
    const result = await installer.install(compressed);
    expect(result).toBe(3);
    expect(new TextDecoder().decode(fs.readFile("/sysroot/include/wasm.hpp"))).toBe("wasm");
    expect(fs.exists("/sysroot/lib/libwasm.a")).toBe(true);
  });
});
