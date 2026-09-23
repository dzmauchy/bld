import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { transform } from "@solidjs/compiler";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);

function packageVersion(specifier: string): string {
  let dir = dirname(require.resolve(specifier));
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (manifest.name === specifier && typeof manifest.version === "string") return manifest.version;
    } catch {
      // Keep walking toward the package root.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Unable to read the version of ${specifier}`);
}

test("Solid 2 compiler event keys match the client runtime", () => {
  const solidVersion = packageVersion("solid-js");
  const webVersion = packageVersion("@solidjs/web");
  const compilerVersion = packageVersion("@solidjs/compiler");
  expect(webVersion).toBe(solidVersion);
  expect(compilerVersion).toBe(solidVersion);

  const compiled = transform(`export function Button(){ return <button type="button" onClick={() => 0}>Go</button>; }`, {
    filename: "Button.tsx",
    generate: "dom",
  }).code;
  expect(compiled).toContain("._$$click");
  expect(compiled).toContain('delegateEvents(["click"])');
});
