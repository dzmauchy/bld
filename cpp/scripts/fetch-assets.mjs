import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const TAG = "clang-lld-23-wasm-latest";
const BASE = `https://github.com/dzmauchy/bld/releases/download/${TAG}`;
const FILES = ["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"];

const dest = join(dirname(fileURLToPath(import.meta.url)), "../vendor");
await mkdir(dest, { recursive: true });

for (const name of FILES) {
  const outPath = join(dest, name);
  try {
    const existing = await stat(outPath);
    if (existing.size > 0) {
      console.log(`skip ${name} (${existing.size} bytes)`);
      continue;
    }
  } catch {
    // download when missing
  }

  const url = `${BASE}/${name}`;
  console.log(`downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outPath));
  const downloaded = await stat(outPath);
  console.log(`wrote ${name} (${downloaded.size} bytes)`);
}
