import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { MemoryFileSystem } from "cpp/filesystem.ts";
import { SysrootInstaller } from "cpp/sysroot.ts";
import { TarArchive } from "cpp/tarArchive.mjs";
import { packTar } from "../../../tests/tarFixture.ts";

const longName = `sysroot/include/${"nested/".repeat(20)}long.hpp`;
const contents = 'namespace test { const char* label = "µ"; }\n';

describe("native tar archive decoder", () => {
  for (const format of ["ustar", "gnu", "pax"]) {
    test(`installs an independently generated ${format} archive`, async () => {
      const gzip = await readFile(new URL(`../fixtures/tar/${format}.tgz`, import.meta.url));
      const fs = new MemoryFileSystem();
      expect(await new SysrootInstaller(fs).install(gzip)).toBe(format === "pax" ? 4 : 3);
      expect(fs.readFile("/sysroot/include/empty.h")).toHaveLength(0);
      expect(new TextDecoder().decode(fs.readFile(`/${longName}`))).toBe(contents);
      expect(fs.readFile("/sysroot/lib/libtest.a")).toEqual(new Uint8Array([0, 128, 255, 66]));
      expect(fs.exists("/sysroot/include/link.h")).toBe(false);
      if (format === "pax") expect(new TextDecoder().decode(fs.readFile("/sysroot/include/測定.hpp"))).toBe(contents);
    });
  }

  test("accepts gzip streams split inside headers and file bodies", async () => {
    const gzip = await readFile(new URL("../fixtures/tar/pax.tgz", import.meta.url));
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === gzip.length) return controller.close();
        controller.enqueue(gzip.subarray(offset, offset += Math.min(7, gzip.length - offset)));
      },
    });
    const fs = new MemoryFileSystem();
    expect(await new SysrootInstaller(fs).install(stream)).toBe(4);
    expect(new TextDecoder().decode(fs.readFile(`/${longName}`))).toBe(contents);
  });

  test("returns file views into the supplied tar without copying", async () => {
    const gzip = await readFile(new URL("../fixtures/tar/ustar.tgz", import.meta.url));
    const tar = gunzipSync(gzip);
    const archive = await TarArchive.read(tar, false);
    const file = [...archive.files()].find((entry) => entry.name === longName)!;
    expect(file.data.buffer).toBe(tar.buffer);
    expect(new TextDecoder().decode(file.data)).toBe(contents);
  });

  test("rejects corrupt checksums and truncated headers or file bodies", async () => {
    const gzip = await readFile(new URL("../fixtures/tar/ustar.tgz", import.meta.url));
    const tar = gunzipSync(gzip);
    const corrupt = new Uint8Array(tar);
    corrupt[0] ^= 1;
    expect(() => [...new TarArchive(corrupt).files()]).toThrow("checksum");
    expect(() => [...new TarArchive(tar.subarray(0, 20)).files()]).toThrow("header");
    expect(() => [...new TarArchive(tar.subarray(0, 1537)).files()]).toThrow("truncated tar entry");
    await expect(TarArchive.read(gzip.subarray(0, gzip.length - 8))).rejects.toThrow();
  });

  test("ignores non-sysroot files and unsafe paths", async () => {
    const tar = packTar([
      { header: { name: "sysroot/../outside.a", size: 1 }, body: "x" },
      { header: { name: "other/include/test.h", size: 1 }, body: "x" },
      { header: { name: "sysroot/share/license.txt", size: 1 }, body: "x" },
    ]);
    expect(await new SysrootInstaller(new MemoryFileSystem()).install(tar, false)).toBe(0);
  });
});
