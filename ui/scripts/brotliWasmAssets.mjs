import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const wasmMagic = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

/** Workers static assets reject a single file at or above 25 MiB. */
export const workersAssetByteLimit = 25 * 1024 * 1024;

/**
 * Replaces oversized WebAssembly assets with maximum-quality Brotli bytes.
 * `_headers` must not set `Content-Encoding`: Workers would compress the
 * stored Brotli again, and the browser would compile the leftover bytes.
 * `worker/index.ts` serves those URLs with `encodeBody: "manual"`.
 */
export class BrotliWasmAssetCompressor {
  #distDirectory;
  #byteLimit;

  constructor(distDirectory, byteLimit = workersAssetByteLimit) {
    this.#distDirectory = distDirectory;
    this.#byteLimit = byteLimit;
  }

  async compress() {
    const wasmFiles = await this.#wasmFiles(this.#distDirectory);
    const compressed = [];
    for (const file of wasmFiles) {
      const bytes = await readFile(file);
      if (!bytes.subarray(0, wasmMagic.length).equals(wasmMagic)) continue;
      if (bytes.length <= this.#byteLimit) continue;
      const encoded = this.compressWasm(bytes);
      if (encoded.length > this.#byteLimit) {
        throw new Error(
          `${relative(this.#distDirectory, file)} is ${encoded.length} bytes after Brotli, above the ${this.#byteLimit} byte Workers asset limit`,
        );
      }
      await writeFile(file, encoded);
      compressed.push(this.#urlPath(file));
    }
    if (compressed.length > 0) await this.#writeHeaders(compressed);
    return compressed;
  }

  compressWasm(bytes) {
    return brotliCompressSync(bytes, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_LGWIN]: zlibConstants.BROTLI_MAX_WINDOW_BITS,
      },
    });
  }

  async #wasmFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await this.#wasmFiles(path)));
      else if (entry.name.endsWith(".wasm")) files.push(path);
    }
    return files;
  }

  #urlPath(file) {
    const urlPath = relative(this.#distDirectory, file).split(sep).join("/");
    return `/${urlPath}`;
  }

  async #writeHeaders(urlPaths) {
    const headersFile = join(this.#distDirectory, "_headers");
    const existing = await readFile(headersFile, "utf8").catch(() => "");
    const rules = urlPaths
      .filter((urlPath) => !existing.includes(`${urlPath}\n`))
      .map((urlPath) => this.headerRule(urlPath));
    if (rules.length === 0) return;
    const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
    await writeFile(headersFile, `${prefix}${rules.join("\n")}\n`);
  }

  headerRule(urlPath) {
    return [
      urlPath,
      "  Content-Type: application/wasm",
      "  Cache-Control: public, max-age=0, must-revalidate, no-transform",
    ].join("\n");
  }
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const distDirectory = join(dirname(fileURLToPath(import.meta.url)), "../dist");
  const compressed = await new BrotliWasmAssetCompressor(distDirectory).compress();
  for (const urlPath of compressed) console.log(`brotli ${urlPath}`);
}
