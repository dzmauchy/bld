import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import asc from "assemblyscript/asc";

if (!parentPort) {
  throw new Error("compile.worker must run as a worker thread");
}

parentPort.on("message", async (message) => {
  if (message?.type !== "compile") return;
  const { id, source, assemblyDir } = message;
  try {
    const wasm = await compileGenerated(source, assemblyDir);
    parentPort.postMessage({ id, type: "ok", wasm });
  } catch (error) {
    parentPort.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

async function compileGenerated(source, assemblyDir) {
  const files = new Map();
  const argv = [
    "generated.ts",
    "--baseDir",
    assemblyDir,
    "--outFile",
    "generated.wasm",
    "--exportRuntime",
    "--runtime",
    "incremental",
    "--debug",
    "--optimizeLevel",
    "0",
  ];

  const result = await asc.main(argv, {
    readFile(filename, baseDir) {
      const normalized = filename.replace(/\\/g, "/");
      if (normalized === "generated.ts" || normalized.endsWith("/generated.ts")) {
        return source;
      }
      const candidates = [
        join(baseDir, filename),
        join(assemblyDir, filename),
        join(assemblyDir, normalized.replace(/^\.\//, "")),
      ];
      for (const candidate of candidates) {
        try {
          return readFileSync(candidate, "utf8");
        } catch {
          // try next location
        }
      }
      return null;
    },
    listFiles(dir, baseDir) {
      try {
        return readdirSync(join(baseDir, dir)).filter((name) => name.endsWith(".ts"));
      } catch {
        return null;
      }
    },
    writeFile(filename, contents) {
      files.set(filename.replace(/\\/g, "/"), contents);
    },
  });

  if (result.error) {
    throw new Error(`${result.stderr.toString()}\n${result.error.message}`);
  }

  const wasm = files.get("generated.wasm");
  if (!(wasm instanceof Uint8Array)) {
    throw new Error(`asc did not emit wasm. files=${[...files.keys()].join(",")}`);
  }
  return wasm;
}
