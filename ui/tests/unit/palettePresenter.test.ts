import { expect, test } from "@rstest/core";
import { Library, type PackageManifest } from "core";
import { BlockGlyphCatalog } from "../../src/view/palette/blockGlyphs.js";
import {
  BlockAccent,
  LibraryListPalettePresenter,
  NamespacePalettePresenter,
  PaletteExpansion,
} from "../../src/view/palette/palettePresenter.js";

const manifest: PackageManifest = {
  id: "demo",
  name: "Demo",
  icon: "library-base.svg",
  location: "memory:demo",
};

function demoLibrary(): Library {
  return Library.fromManifest(manifest, {
    namespaces: {
      push: {
        name: "Push Dataflows",
        children: {
          f32: {
            name: "Single precision push dataflows",
            children: {
              sinks: { name: "Sinks", children: {} },
              sources: { name: "Sources", children: {} },
              transformers: { name: "Transformers", children: {} },
            },
          },
          f64: {
            name: "Double precision push dataflows",
            children: {
              sources: { name: "Sources", children: {} },
            },
          },
        },
      },
      math: { name: "math", children: {} },
    },
    blocks: {
      ScopeF32: { ns: ["push", "f32", "sinks"], title: "Scope", icon: "scope.svg", description: "Displays" },
      SinF32: { ns: ["push", "f32", "transformers"], title: "sin", icon: "sin.svg" },
      ConstF32: { ns: ["push", "f32", "sources"], title: "Constant", icon: "push.const.svg" },
      PulseF32: { ns: ["push", "f32", "sources"], title: "Pulse", icon: "push.pulse-gen.svg" },
      ConstF64: { ns: ["push", "f64", "sources"], title: "Constant", icon: "push.const.svg" },
      Orphan: { ns: ["custom", "leaf"], title: "Orphan", icon: "process.svg" },
    },
  });
}

test("groups blocks into a namespace tree and drops empty folders", () => {
  const groups = new NamespacePalettePresenter(demoLibrary()).present();
  expect(groups.map((group) => group.label)).toEqual(["Custom", "Push Dataflows"]);

  const push = groups[1];
  expect(push?.hint).toBe("Push Dataflows");
  expect(push?.children.map((group) => [group.label, group.hint])).toEqual([
    ["F32", "Single precision push dataflows"],
    ["F64", "Double precision push dataflows"],
  ]);

  const f32 = push?.children[0];
  expect(f32?.children.map((group) => group.label)).toEqual(["Sources", "Transformers", "Sinks"]);
  expect(f32?.children[0]?.blocks.map((block) => block.id)).toEqual(["ConstF32", "PulseF32"]);
  expect(f32?.children[1]?.blocks.map((block) => block.id)).toEqual(["SinF32"]);
  expect(f32?.children[2]?.blocks.map((block) => block.id)).toEqual(["ScopeF32"]);
  expect(groups.some((group) => group.ids().includes("math"))).toBe(false);
});

test("wraps each library when more than one is loaded", () => {
  const demo = demoLibrary();
  const other = Library.fromManifest(
    { ...manifest, id: "other", name: "Other" },
    { blocks: { Local: { ns: ["samples"], title: "Local", icon: "process.svg" } } },
  );
  const single = new LibraryListPalettePresenter([demo]).present();
  expect(single.map((group) => group.id)).toEqual(["custom", "push"]);

  const both = new LibraryListPalettePresenter([demo, other]).present();
  expect(both.map((group) => group.label)).toEqual(["Demo", "Other"]);
  expect(both[1]?.children.map((group) => group.label)).toEqual(["Samples"]);
  expect(both[1]?.libraryId).toBe("other");
});

test("expansion toggles one folder without mutating the previous set", () => {
  const groups = new NamespacePalettePresenter(demoLibrary()).present();
  const open = PaletteExpansion.expanded(groups);
  expect(open.has("push::f32::sources")).toBe(true);
  const closed = open.toggled("push::f32::sources");
  expect(closed.has("push::f32::sources")).toBe(false);
  expect(open.has("push::f32::sources")).toBe(true);
  expect(closed.toggled("push::f32::sources").has("push::f32::sources")).toBe(true);
});

test("block accents follow the palette category", () => {
  expect(BlockAccent.forCategory("sources").className).toBe("block-kind-data");
  expect(BlockAccent.forCategory("transformers").className).toBe("block-kind-process");
  expect(BlockAccent.forCategory("sinks").className).toBe("block-kind-output");
});

test("glyph catalog resolves library icon names to stroke svgs", () => {
  const glyphs = BlockGlyphCatalog.shared;
  expect(glyphs.markup("cos.svg")).toContain("M1.5 3c");
  expect(glyphs.markup("push.const.svg")).toContain("M1.5 12H5");
  expect(glyphs.markup("push.sin-gen.svg")).toContain("M1.5 8c");
  expect(glyphs.markup("push.pulse-gen.svg")).toContain("M1.5 11.5");
  expect(glyphs.markup("sum.svg")).toContain("M8 3.2v9.6");
  expect(glyphs.markup("missing.svg")).toContain("M5.5 8h5");
  expect(glyphs.markup("scope.svg").match(/<svg/g)).toHaveLength(1);
});
