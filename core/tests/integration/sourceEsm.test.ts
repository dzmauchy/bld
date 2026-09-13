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
  test("context.ts erases to a module with no runtime exports", () => {
    const code = transformTypeScript(readFileSync(join(riDir, "context.ts"), "utf8"));
    expect(code).not.toMatch(/\bexport\b/);
  });

  test("blocks.ts does not import type-only names from context as runtime values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ri-source-esm-"));
    const blocks = transformTypeScript(readFileSync(join(riDir, "blocks.ts"), "utf8"));
    const context = transformTypeScript(readFileSync(join(riDir, "context.ts"), "utf8"));

    expect(blocks).not.toMatch(/from\s*["']\.\/context["']/);

    writeFileSync(join(dir, "context.js"), context);
    writeFileSync(join(dir, "blocks.js"), blocks.replaceAll('"./context"', '"./context.js"'));

    const loaded = await import(pathToFileURL(join(dir, "blocks.js")).href);
    expect(loaded.push.f32.transformers.cos_f32).toBeTypeOf("function");
  });
});
