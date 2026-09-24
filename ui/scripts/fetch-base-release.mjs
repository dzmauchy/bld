import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const releaseUrl = "https://github.com/dzmauchy/bld-base/releases/download/v0.1.0/base-0.1.0.tar.gz";
const destination = join(dirname(fileURLToPath(import.meta.url)), "../public/base-0.1.0.tar.gz");

const existing = await stat(destination).catch(() => undefined);
if (existing && existing.size > 0) process.exit(0);

const response = await fetch(releaseUrl);
if (!response.ok || !response.body) {
  throw new Error(`Failed to download ${releaseUrl}: ${response.status} ${response.statusText}`);
}
await mkdir(dirname(destination), { recursive: true });
await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
