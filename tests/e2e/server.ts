import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build, preview } from "vite";
import type { TestProject } from "vitest/node";

/** Build and serve the actual production app for browser tests. */
export async function setup(project: TestProject) {
  const workspace = project.config.name === "cpp-e2e" ? "cpp" : "ui";
  const root = fileURLToPath(new URL(`../../${workspace}/`, import.meta.url));
  if (workspace === "ui") await promisify(execFile)(process.execPath, [join(root, "scripts/fetch-base-release.mjs")], { cwd: root });
  const configFile = join(root, "vite.config.ts");
  await build({ root, configFile, logLevel: "warn" });
  const server = await preview({ root, configFile, logLevel: "warn", preview: { port: 0 } });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Vite preview did not start");
  project.provide("baseURL", `http://localhost:${address.port}`);
  project.provide("artifactDir", join(dirname(configFile), "test-results"));
  return async () => { await new Promise<void>((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve())); };
}
