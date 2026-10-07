import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { unpackTar } from "modern-tar";

const releaseUrl = "https://github.com/dzmauchy/bld-base/releases/download/v0.1.0/base-0.1.0.tar.gz";
const destination = join(dirname(fileURLToPath(import.meta.url)), "../public/base-0.1.0.tar.gz");

export async function isCurrentBaseRelease(bytes) {
  try {
    const entries = await unpackTar(gunzipSync(bytes));
    const meta = entries.find((entry) => entry.header.name.replace(/^\.\//, "") === "meta.json");
    const parsed = JSON.parse(new TextDecoder().decode(meta?.data));
    return Array.isArray(parsed.blocks) && Array.isArray(parsed.namespaces)
      && parsed.blocks.every((block) => Array.isArray(block.parameters))
      && entries.some((entry) => entry.header.name.replace(/^\.\//, "") === "base/f32_blocks.hpp"
        && /core::function<[^;]*\bScopeF32\(/.test(new TextDecoder().decode(entry.data)))
      && entries.some((entry) => entry.header.name.replace(/^\.\//, "") === "core/lib.hpp");
  } catch { return false; }
}
async function fetchBaseRelease() {
  if (await isCurrentBaseRelease(await readFile(destination).catch(() => new Uint8Array()))) return;
  const response = await fetch(releaseUrl);
  if (!response.ok) throw new Error(`Failed to download ${releaseUrl}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!await isCurrentBaseRelease(bytes)) throw new Error("Base release is missing valid metadata or callable block factories");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(`${destination}.tmp`, bytes);
  await rename(`${destination}.tmp`, destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await fetchBaseRelease();
