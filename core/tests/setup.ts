import { beforeEach } from "vitest";
import { setAppAssetResolver } from "../src/model/appAssets.js";
import "../src/model/hostClangAstDumper.ts";
import { readNodeAsset } from "./readNodeAsset.ts";

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
