import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { expect, test } from "@rstest/core";
import config from "../../rsbuild.config.ts";

test("the copied router asset uses standard exceptions and preserves its Wasm interface", async () => {
  const require = createRequire(import.meta.url);
  const input = await readFile(join(dirname(require.resolve("libavoid-js")), "libavoid.wasm"));
  const copy = config.output?.copy;
  const asset = Array.isArray(copy) ? copy[2] : undefined;
  if (!asset || typeof asset === "string" || typeof asset.transform !== "function") {
    throw new Error("The libavoid copy must convert exception instructions");
  }
  const output = await asset.transform(input, "libavoid.wasm");
  expect(Buffer.isBuffer(output)).toBe(true);
  const original = new WebAssembly.Module(new Uint8Array(input));
  const converted = new WebAssembly.Module(new Uint8Array(output as Buffer));
  expect(WebAssembly.Module.imports(converted)).toEqual(WebAssembly.Module.imports(original));
  expect(WebAssembly.Module.exports(converted)).toEqual(WebAssembly.Module.exports(original));

  const { default: binaryen } = await import("binaryen");
  const module = binaryen.readBinary(output as Buffer);
  try {
    const text = module.emitText();
    expect(/\(try_table\b/.test(text)).toBe(true);
    expect(text.match(/^\s*\((?:try|catch|catch_all|rethrow|delegate)\b/gm) ?? []).toEqual([]);
  } finally {
    module.dispose();
  }
});
