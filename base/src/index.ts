import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = join(dirname(fileURLToPath(import.meta.url)), "../native");

export const nativeHeaderNames = ["bld.hpp", "base.hpp", "wasm_host.hpp"] as const;

export function nativeLibraryFiles(): Record<string, string> {
  return {
    "bld.hpp": readFileSync(join(nativeRoot, "include/bld.hpp"), "utf8"),
    "base.hpp": readFileSync(join(nativeRoot, "src/base.hpp"), "utf8"),
    "wasm_host.hpp": readFileSync(join(nativeRoot, "src/wasm_host.hpp"), "utf8"),
  };
}
