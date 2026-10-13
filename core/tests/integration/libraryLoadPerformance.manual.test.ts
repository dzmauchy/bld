import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "vitest";
import { Library, type PackageManifest } from "core/model/library.ts";

test("profiles uncached library loading over local HTTP", async () => {
  const manifest: PackageManifest = JSON.parse(await readFile(new URL("../../assets/base.json", import.meta.url), "utf8"));
  const response = await fetch(manifest.location);
  if (!response.ok) throw new Error(`Failed to load base archive: ${response.status}`);
  const archive = new Uint8Array(await response.arrayBuffer());
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { "Content-Type": "application/gzip" });
    response.end(archive);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP benchmark did not start");
    const load = (sample: string) => Library.load({ ...manifest,
      location: `http://127.0.0.1:${address.port}/base.tar.gz?sample=${sample}`,
    });
    // Unique URLs bypass the archive cache. Warm-up excludes initial JIT/startup.
    for (let i = 0; i < 20; i++) await load(`warmup-${i}`);
    const durations: number[] = [];
    const cpuStart = process.cpuUsage();
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      const library = await load(`measured-${i}`);
      durations.push(performance.now() - start);
      expect(library.palette.getBlock("ConstF32")).toBeDefined();
    }
    const cpu = process.cpuUsage(cpuStart);
    durations.sort((a, b) => a - b);
    expect(requests).toBe(220);
    console.log(JSON.stringify({
      label: process.env.BLD_LIBRARY_BENCHMARK_LABEL ?? "current",
      samples: durations.length,
      medianMs: durations[Math.floor(durations.length / 2)],
      p95Ms: durations[Math.floor(durations.length * 0.95)],
      cpuMsPerLoad: (cpu.user + cpu.system) / 1000 / durations.length,
    }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
