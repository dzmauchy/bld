import { expect, test } from "vitest";
import { CoreSchemaCatalog, schemaAssetFiles } from "core";
import headers from "../../public/_headers?raw";
import config from "../../vite.config.ts";
import coreLibrarySchema from "core/assets/schemas/library.schema.json?raw";

const schemaAssets = { "library.schema.json": coreLibrarySchema } as const;

test("Vite publishes the shared schemas and toolchain service worker", () => {
  expect(config.plugins?.some((plugin) => plugin && "name" in plugin && plugin.name === "bld-workspace-assets")).toBe(true);
  expect(Object.keys(schemaAssets).sort()).toEqual([...schemaAssetFiles].sort());
  expect(CoreSchemaCatalog.shared.schemaNames).toEqual(["library"]);
  for (const [name, schema] of Object.entries(schemaAssets)) {
    expect(JSON.parse(schema).$id, name).toContain(`/schemas/${name}`);
  }
});

test("Vite builds the Lit app and its module workers without inlining assets", () => {
  expect(config.build?.target).toBe("esnext");
  expect(config.build?.assetsInlineLimit).toBe(0);
  expect(config.worker?.format).toBe("es");
  expect(config.server?.port).toBe(3001);
  expect(config.preview?.port).toBe(3001);
  for (const server of [config.server, config.preview]) {
    expect(server?.headers?.["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(server?.headers?.["Cross-Origin-Embedder-Policy"]).toBe("require-corp");
  }
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
