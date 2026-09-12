import { expect, test } from "vitest";
import { modelAssetFiles } from "core";
import { App } from "../../src/App.js";
import { modelAssets } from "../../src/modelAssets.js";

test("App renders add(2, 2) and model asset titles", () => {
  expect(App()).toBe(
    [
      "4",
      "blockDefinition.ts Block Definition",
      "compiler.ts Diagram Compiler",
      "connection.ts Connection",
      "defaultCatalog.ts Default Catalog",
      "diagram.ts Diagram",
      "diagramBlock.ts Diagram Block",
      "endpoint.ts Port Endpoint",
      "index.ts Model Index",
      "palette.ts Palette",
    ].join("\n"),
  );
});

test("loads every core model file as a source asset", () => {
  expect(Object.keys(modelAssets).sort()).toEqual([...modelAssetFiles].sort());
  expect(modelAssets["diagram.ts"]).toContain("export class Diagram");
  expect(modelAssets["palette.ts"]).toContain("export class Palette");
  expect(modelAssets["compiler.ts"]).toContain("export class DiagramCompiler");
  expect(modelAssets["connection.ts"]).toContain("export class Connection");
  expect(modelAssets["endpoint.ts"]).toContain("export class PortEndpoint");
});
