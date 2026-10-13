import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";
import { DefaultWasmBindings } from "cpp/bindings.ts";

/** Serve unmodified released assets over real HTTP, retaining downloads between test runs. */
export async function serveToolchain() {
  const release = new LlvmProjectRelease();
  const directory = fileURLToPath(new URL(`../test-results/toolchain/${LlvmProjectRelease.tag}/`, import.meta.url));
  await mkdir(directory, { recursive: true });
  await Promise.all(LlvmProjectRelease.files.map(async name => {
    const path = `${directory}/${name}`;
    try { if ((await stat(path)).size > 0) return; } catch { /* First run downloads the pinned release. */ }
    const response = await fetch(release.assetUrl(name));
    if (!response.ok) throw new Error(`Failed to download ${name}: ${response.status}`);
    const download = `${path}.${process.pid}.download`;
    await writeFile(download, new Uint8Array(await response.arrayBuffer()));
    await rename(download, path);
  }));
  const requests: string[] = [];
  const failures = new Map<string, number>();
  const server = createServer((request, response) => {
    const name = request.url?.slice(1) ?? "";
    requests.push(name);
    if (failures.get(name)) {
      failures.set(name, failures.get(name)! - 1);
      response.writeHead(503).end("temporarily unavailable");
    } else if ((LlvmProjectRelease.files as readonly string[]).includes(name)) {
      response.writeHead(200, { "Content-Type": release.contentType(name) });
      createReadStream(`${directory}/${name}`).pipe(response);
    } else response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    requests, failures,
    assetUrl: (name: string) => `http://127.0.0.1:${port}/${name}`,
    bytes: (name: string) => readFile(`${directory}/${name}`),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

export async function execute(wasm: Uint8Array): Promise<WebAssembly.Exports> {
  const module = await WebAssembly.compile(new Uint8Array(wasm));
  const instance = await WebAssembly.instantiate(module, new DefaultWasmBindings().fill(module));
  (instance.exports.wasm_initialize as () => void)();
  return instance.exports;
}
