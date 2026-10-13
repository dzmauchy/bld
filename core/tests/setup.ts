import { beforeEach } from "vitest";
import { setAppAssetResolver } from "core/model/appAssets.ts";
import "cpp/hostClangAstDumper.ts";
import { readNodeAsset } from "./readNodeAsset.ts";

setAppAssetResolver(readNodeAsset);

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
