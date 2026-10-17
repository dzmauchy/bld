import { describe, expect, test } from "vitest";
import { CppBlockCatalog } from "core/model/cppBlockCatalog.ts";
import { Diagram } from "core/model/diagram.ts";
import { Palette } from "core/model/palette.ts";

function createPalette(): Palette {
  return Palette.fromCatalog({
    other: { title: "ExactId helper", description: "A searchable description", cpp: "custom::Other" },
    ExactId: { title: "Target", description: "The target block", cpp: "custom::Target" },
  }, {});
}

describe("Palette search", () => {
  test("an exact ID returns only its block before matching titles", () => {
    const palette = createPalette();
    expect(palette.search(" ExactId ").map((block) => block.id).toArray()).toEqual(["ExactId"]);
  });

  test("matches titles and descriptions without matching ID substrings", () => {
    const palette = createPalette();
    expect(palette.search(" TARGET ").map((block) => block.id).toArray()).toEqual(["ExactId"]);
    expect(palette.search(" SEARCHABLE ").map((block) => block.id).toArray()).toEqual(["other"]);
    expect(palette.search("xact").map((block) => block.id).toArray()).toEqual(["other"]);
    expect(palette.search("Other").toArray()).toEqual([]);
  });

  test("blank queries enumerate all blocks in registration order", () => {
    expect(createPalette().search("  ").map((block) => block.id).toArray()).toEqual(["other", "ExactId"]);
  });

  test("diagram and C++ catalog references require exact IDs", () => {
    const palette = createPalette();
    const diagram = new Diagram("test", "Test", palette);
    const catalog = CppBlockCatalog.fromPalette(palette);
    expect(diagram.addBlock("ExactId", { x: 0, y: 0 }).ref).toBe("ExactId");
    expect(catalog.require("ExactId").id).toBe("ExactId");
    for (const query of ["Target", "xact", "", " ExactId "]) {
      expect(() => diagram.addBlock(query, { x: 0, y: 0 })).toThrow(/Unknown block definition/);
      expect(catalog.get(query)).toBeUndefined();
    }
  });
});
