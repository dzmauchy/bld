import { expect, test } from "vitest";
import { compileAssembly } from "core/as/compile.ts";
import { instantiateWasm } from "core/as/run.ts";
import { assemblyAssets } from "../assemblyAssets.ts";

test("UI assembly assets compile and instantiate through core as runtime", async () => {
  const wasm = await compileAssembly(
    `
import { Block } from "./basic";

export function ping(): i32 {
  return 1;
}
`,
    assemblyAssets,
  );
  const instance = await instantiateWasm(wasm);
  expect((instance.exports.ping as () => number)()).toBe(1);
}, 30_000);
