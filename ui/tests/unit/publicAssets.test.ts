import { expect, test } from "vitest";
import { CoreSchemaCatalog, schemaAssetFiles } from "core";
import headers from "../../public/_headers?raw";
import config, { rawHeaderRule } from "../../rsbuild.config.ts";
import coreLibrarySchema from "core/assets/schemas/library.schema.json?raw";

const schemaAssets = {
  "library.schema.json": coreLibrarySchema,
} as const;

test("rsbuild copies core JSON schemas to /schemas", () => {
  expect(config.output?.copy).toEqual([{ from: "../core/assets/schemas", to: "schemas" }]);
  expect(Object.keys(schemaAssets).sort()).toEqual([...schemaAssetFiles].sort());
  expect(CoreSchemaCatalog.shared.schemaNames).toEqual(["library"]);
  for (const [name, schema] of Object.entries(schemaAssets)) {
    expect(JSON.parse(schema).$id, name).toContain(`/schemas/${name}`);
  }
});

test("rspack loads library headers as raw source", () => {
  const rspack = config.tools?.rspack;
  expect(rspack).toMatchObject({ module: { rules: [rawHeaderRule] } });
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
