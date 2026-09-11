import { expect, test } from "vitest";
import headers from "../../public/_headers?raw";
import uiBlocksSchema from "../../public/schemas/blocks.schema.json?raw";
import uiNamespacesSchema from "../../public/schemas/namespaces.schema.json?raw";
import uiTypesSchema from "../../public/schemas/types.schema.json?raw";
import coreBlocksSchema from "../../../core/assets/schemas/blocks.schema.json?raw";
import coreNamespacesSchema from "../../../core/assets/schemas/namespaces.schema.json?raw";
import coreTypesSchema from "../../../core/assets/schemas/types.schema.json?raw";

const schemaAssets = {
  "blocks.schema.json": [uiBlocksSchema, coreBlocksSchema],
  "namespaces.schema.json": [uiNamespacesSchema, coreNamespacesSchema],
  "types.schema.json": [uiTypesSchema, coreTypesSchema],
} as const;

test("publishes every core JSON schema under public/schemas", () => {
  for (const [name, [uiSchema, coreSchema]] of Object.entries(schemaAssets)) {
    expect(uiSchema, name).toBe(coreSchema);
    expect(JSON.parse(uiSchema).$id).toContain(`/schemas/${name}`);
  }
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
