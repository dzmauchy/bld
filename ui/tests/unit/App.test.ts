import { expect, test } from "vitest";
import { modelAssetFiles } from "core";
import { modelAssets } from "../../src/modelAssets.js";

test("loads every core model file as a source asset", () => {
  expect(Object.keys(modelAssets).sort()).toEqual([...modelAssetFiles].sort());
  expect(modelAssets["diagram.ts"]).toContain("export class Diagram");
  expect(modelAssets["palette.ts"]).toContain("export class Palette");
  expect(modelAssets["compiler.ts"]).toContain("export class DiagramCompiler");
  expect(modelAssets["connection.ts"]).toContain("export class Connection");
  expect(modelAssets["endpoint.ts"]).toContain("export class PortEndpoint");
});
