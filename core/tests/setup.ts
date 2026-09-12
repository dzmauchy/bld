import { beforeEach } from "vitest";
import { setAppAssetResolver, registerAppAsset } from "../src/model/appAssets.js";
import { readNodeAsset } from "./readNodeAsset.ts";
import { install } from "base";
import { installLibrary, registerAssemblyUrl } from "runtime";
import "runtime/compile.ts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

installLibrary(install);

const assemblyPath = join(dirname(fileURLToPath(import.meta.url)), "../../base/dist/assembly.js");
if (existsSync(assemblyPath)) {
  registerAssemblyUrl("assembly.js", pathToFileURL(assemblyPath).href);
  registerAppAsset("assembly.js", readFileSync(assemblyPath, "utf8"));
}

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
