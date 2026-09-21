import { describe, expect, test } from "vitest";
import { CoreSchemaCatalog, SchemaCatalog, schemaAssetFiles } from "../../src/index.js";

describe("SchemaCatalog", () => {
  test("CoreSchemaCatalog publishes every core JSON schema path", () => {
    const catalog = CoreSchemaCatalog.shared;
    expect(catalog).toBeInstanceOf(SchemaCatalog);
    expect(catalog.publicDirectory).toBe("schemas");
    expect(catalog.schemaFileName("library")).toBe("library.schema.json");
    expect(catalog.publishedPath("library")).toBe("schemas/library.schema.json");
    expect(catalog.publishedFiles()).toEqual(schemaAssetFiles);
    expect(schemaAssetFiles).toEqual(["library.schema.json"]);
  });
});
