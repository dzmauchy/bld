import { expect, test } from "@rstest/core";
import { PLUGIN_SOLID_NAME } from "@rsbuild/plugin-solid";
import { CoreSchemaCatalog, schemaAssetFiles } from "core";
import headers from "../../public/_headers?raw";
import config from "../../rsbuild.config.ts";
import coreLibrarySchema from "core/assets/schemas/library.schema.json?raw";

const schemaAssets = {
  "library.schema.json": coreLibrarySchema,
} as const;

test("rsbuild copies core JSON schemas to /schemas", () => {
  expect(config.html?.template).toBe("./index.html");
  expect(config.output?.copy).toEqual([
    { from: "../core/assets/schemas", to: "schemas" },
    { from: "../cpp/public/llvm-toolchain-sw.js", to: "./" },
  ]);
  expect(Object.keys(schemaAssets).sort()).toEqual([...schemaAssetFiles].sort());
  expect(CoreSchemaCatalog.shared.schemaNames).toEqual(["library"]);
  for (const [name, schema] of Object.entries(schemaAssets)) {
    expect(JSON.parse(schema).$id, name).toContain(`/schemas/${name}`);
  }
});

test("rsbuild compiles the Solid 2 TSX entry", () => {
  const names = (config.plugins ?? []).flatMap((plugin) =>
    plugin && typeof plugin === "object" && "name" in plugin && typeof plugin.name === "string" ? [plugin.name] : [],
  );
  expect(names).toContain(PLUGIN_SOLID_NAME);
  expect(config.source?.entry).toEqual({ index: "./src/index.tsx" });
  expect(config.output?.module).toBe(true);
  expect(config.html?.scriptLoading).toBe("module");
  expect(config.output?.overrideBrowserslist).toEqual([
    "chrome >= 135",
    "edge >= 135",
    "firefox >= 135",
    "safari >= 18.4",
  ]);
});

test("Cloudflare _headers enable cross-origin isolation for every asset", () => {
  expect(headers).toMatch(/^\/\*/m);
  expect(headers).toContain("Cross-Origin-Opener-Policy: same-origin");
  expect(headers).toContain("Cross-Origin-Embedder-Policy: require-corp");
});
