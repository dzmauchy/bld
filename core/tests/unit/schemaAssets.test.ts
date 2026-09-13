import { describe, expect, test } from "vitest";
import { CoreSchemaCatalog, SchemaCatalog, diagramSchemaPath, schemaAssetFiles } from "../../src/index.js";

describe("SchemaCatalog", () => {
  test("CoreSchemaCatalog publishes every core JSON schema path", () => {
    const catalog = CoreSchemaCatalog.shared;
    expect(catalog).toBeInstanceOf(SchemaCatalog);
    expect(catalog.publicDirectory).toBe("schemas");
    expect(catalog.schemaFileName("diagram")).toBe("diagram.schema.json");
    expect(catalog.publishedPath("diagram")).toBe("schemas/diagram.schema.json");
    expect(catalog.publishedFiles()).toEqual(schemaAssetFiles);
    expect(diagramSchemaPath).toBe("schemas/diagram.schema.json");
  });
});
