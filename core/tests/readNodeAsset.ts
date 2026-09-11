import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export async function readNodeAsset(cleanPath: string): Promise<string | undefined> {
  const cwd = process.cwd();
  const candidates = [
    join(currentDir, "../assets", cleanPath),
    join(currentDir, "../../core/assets", cleanPath),
    join(currentDir, "../../base/dist", cleanPath),
    join(cwd, "assets", cleanPath),
    join(cwd, "core/assets", cleanPath),
    join(cwd, "base/dist", cleanPath),
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Continue to next candidate
    }
  }
  return undefined;
}
