import { afterAll, beforeEach } from "vitest";
import { setAppAssetResolver } from "core/model/appAssets.ts";
import { ClangAstDumper } from "cpp";
import { TestToolchain } from "../../cpp/tests/toolchain.ts";
import { readNodeAsset } from "./readNodeAsset.ts";

setAppAssetResolver(readNodeAsset);
const dumper = new TestToolchain();
ClangAstDumper.register(dumper);
afterAll(() => dumper.close());

beforeEach(() => {
  setAppAssetResolver(readNodeAsset);
});
