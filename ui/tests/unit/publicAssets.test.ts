import { expect, test } from "vitest";
import headers from "../../public/_headers?raw";
import config from "../../rsbuild.config.ts";
import coreBlocksSchema from "core/schemas/blocks.schema.json?raw";
import coreLibrarySchema from "core/schemas/library.schema.json?raw";
import coreNamespacesSchema from "core/schemas/namespaces.schema.json?raw";
import coreTypesSchema from "core/schemas/types.schema.json?raw";

const schemaAssets = {
  "blocks.schema.json": coreBlocksSchema,
  "library.schema.json": coreLibrarySchema,
  "namespaces.schema.json": coreNamespacesSchema,
  "types.schema.json": coreTypesSchema,
} as const;

test("rsbuild copies core JSON schemas to /schemas", () => {
  expect(config.output?.copy).toEqual([{ from: "../core/assets/schemas", to: "schemas" }]);
  for (const [name, schema] of Object.entries(schemaAssets)) {
    expect(JSON.parse(schema).$id, name).toContain(`/schemas/${name}`);
  }
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
