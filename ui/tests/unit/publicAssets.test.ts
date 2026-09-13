import { expect, test } from "vitest";
import { CoreSchemaCatalog, schemaAssetFiles } from "core";
import headers from "../../public/_headers?raw";
import config from "../../rsbuild.config.ts";
import coreBlocksSchema from "core/assets/schemas/blocks.schema.json?raw";
import coreDiagramSchema from "core/assets/schemas/diagram.schema.json?raw";
import coreLibrarySchema from "core/assets/schemas/library.schema.json?raw";
import coreNamespacesSchema from "core/assets/schemas/namespaces.schema.json?raw";
import coreTypesSchema from "core/assets/schemas/types.schema.json?raw";

const schemaAssets = {
  "blocks.schema.json": coreBlocksSchema,
  "diagram.schema.json": coreDiagramSchema,
  "library.schema.json": coreLibrarySchema,
  "namespaces.schema.json": coreNamespacesSchema,
  "types.schema.json": coreTypesSchema,
} as const;

test("rsbuild copies core JSON schemas to /schemas", () => {
  expect(config.output?.copy).toEqual([{ from: "../core/assets/schemas", to: "schemas" }]);
  expect(Object.keys(schemaAssets).sort()).toEqual([...schemaAssetFiles].sort());
  expect(CoreSchemaCatalog.shared.schemaNames).toEqual([
    "blocks",
    "diagram",
    "library",
    "namespaces",
    "types",
  ]);
  for (const [name, schema] of Object.entries(schemaAssets)) {
    expect(JSON.parse(schema).$id, name).toContain(`/schemas/${name}`);
  }
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
