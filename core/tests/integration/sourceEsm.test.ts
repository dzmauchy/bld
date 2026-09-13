import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, test } from "vitest";

const riDir = join(dirname(fileURLToPath(import.meta.url)), "../../src/ri");

function transformTypeScript(source: string): string {
  return transformSync(source, { loader: "ts", format: "esm" }).code;
}

describe("RI TypeScript sources as independently transformed ESM", () => {
  const blocksSource = readFileSync(join(riDir, "blocks.ts"), "utf8");
  const contextSource = readFileSync(join(riDir, "context.ts"), "utf8");

  test("context aliases stay type-only so Playwright does not import them as values", () => {
    expect(contextSource).toMatch(/^export type f32 = /m);
    expect(blocksSource).toMatch(/^import type \{[^}]*\bf32\b[^}]*\} from "\.\/context";/m);
    expect(blocksSource).not.toMatch(/^import \{[^}]*\bf32\b[^}]*\} from "\.\/context";/m);
  });

  test("isolated ESM transform of blocks.ts loads without a runtime context binding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ri-source-esm-"));
    const blocks = transformTypeScript(blocksSource);
    const context = transformTypeScript(contextSource);

    expect(context).not.toMatch(/\bexport\b/);
    expect(blocks).not.toMatch(/from\s*["']\.\/context["']/);

    writeFileSync(join(dir, "context.js"), context);
    writeFileSync(join(dir, "blocks.js"), blocks.replaceAll('"./context"', '"./context.js"'));

    const loaded = await import(pathToFileURL(join(dir, "blocks.js")).href);
    expect(loaded.push.f32.transformers.cos_f32).toBeTypeOf("function");
  });
});
