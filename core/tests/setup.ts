import { beforeEach } from "vitest";
import { setAppAssetResolver, registerAppAsset } from "../src/model/appAssets.js";
import { readNodeAsset } from "./readNodeAsset.ts";
import { install } from "base";
import { installLibrary } from "runtime";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

installLibrary(install);

const assemblyPath = join(dirname(fileURLToPath(import.meta.url)), "../../base/dist/assembly.js");
try {
  registerAppAsset("assembly.js", readFileSync(assemblyPath, "utf8"));
} catch {
  // Bundle is produced by `npm run bundle -w base` before tests.
}

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
