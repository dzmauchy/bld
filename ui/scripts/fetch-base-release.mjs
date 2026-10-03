import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { unpackTar } from "modern-tar";

const releaseUrl = "https://github.com/dzmauchy/bld-base/releases/download/v0.1.0/base-0.1.0.tar.gz";
const destination = join(dirname(fileURLToPath(import.meta.url)), "../public/base-0.1.0.tar.gz");

async function valid(bytes) {
  try {
    const entries = await unpackTar(gunzipSync(bytes));
    const meta = entries.find((entry) => entry.header.name.replace(/^\.\//, "") === "meta.json");
    const parsed = JSON.parse(new TextDecoder().decode(meta?.data));
    return Array.isArray(parsed.blocks) && Array.isArray(parsed.namespaces)
      && parsed.blocks.every((block) => Array.isArray(block.parameters));
  } catch { return false; }
}
if (await valid(await readFile(destination).catch(() => new Uint8Array()))) process.exit(0);
const response = await fetch(releaseUrl);
if (!response.ok) throw new Error(`Failed to download ${releaseUrl}: ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (!await valid(bytes)) throw new Error("Base release is missing valid meta.json");
await mkdir(dirname(destination), { recursive: true });
await writeFile(`${destination}.tmp`, bytes);
await rename(`${destination}.tmp`, destination);
