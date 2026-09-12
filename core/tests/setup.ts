import { beforeEach } from "vitest";
import { setAppAssetResolver } from "../src/model/appAssets.js";
import { readNodeAsset } from "./readNodeAsset.ts";
import "../src/wasm/compile.ts";

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
