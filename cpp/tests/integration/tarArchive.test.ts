import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { TarArchive } from "cpp/tarArchive.ts";

const longName = `sysroot/include/${"nested/".repeat(20)}long.hpp`;
const contents = 'namespace test { const char* label = "µ"; }\n';

describe("native tar archive decoder", () => {
  for (const format of ["ustar", "gnu", "pax"]) {
    test(`decodes an independently generated ${format} archive`, async () => {
      const gzip = await readFile(new URL(`../fixtures/tar/${format}.tgz`, import.meta.url));
      const files = new Map([...(await TarArchive.read(gzip)).files()].map(file => [file.name, file.data]));
      expect(files.size).toBe(format === "pax" ? 4 : 3);
      expect(files.get("sysroot/include/empty.h")).toHaveLength(0);
      expect(new TextDecoder().decode(files.get(longName))).toBe(contents);
      expect(files.get("sysroot/lib/libtest.a")).toEqual(new Uint8Array([0, 128, 255, 66]));
      expect(files.has("sysroot/include/link.h")).toBe(false);
      if (format === "pax") expect(new TextDecoder().decode(files.get("sysroot/include/測定.hpp"))).toBe(contents);
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
    const files = [...(await TarArchive.read(stream)).files()];
    expect(files).toHaveLength(4);
    expect(new TextDecoder().decode(files.find(file => file.name === longName)?.data)).toBe(contents);
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

});
