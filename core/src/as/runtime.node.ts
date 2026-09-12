import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { ASRuntime, wrapNodeWorker, type CompileFiles, type Thread } from "./runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));

export function nodeThread(specifier: string): Thread {
  return wrapNodeWorker(
    new Worker(join(here, specifier), {
      execArgv: ["--experimental-strip-types", "--no-warnings"],
    }),
  );
}

export function loadAssemblyFiles(dir: string): CompileFiles {
  const files: CompileFiles = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".ts") || name === "tsconfig.json") {
      files[name] = readFileSync(join(dir, name), "utf8");
    }
  }
  return files;
}

export function createNodeASRuntime(
  assemblyDir: string,
  extraFiles?: CompileFiles,
): ASRuntime {
  return new ASRuntime({
    compileThread: nodeThread("compile.worker.ts"),
    runThread: nodeThread("run.worker.ts"),
    files: { ...loadAssemblyFiles(assemblyDir), ...extraFiles },
  });
}
