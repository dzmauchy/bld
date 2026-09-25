import { beforeEach } from "@rstest/core";
import { setAppAssetResolver } from "../src/model/appAssets.js";
import "cpp/hostClangAstDumper.ts";
import { readNodeAsset } from "./readNodeAsset.ts";
import "./nodeFileFetch.ts";

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
