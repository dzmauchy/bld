import { expect, test } from "vitest";
import { Library, registerAppAssets } from "core";
import "core/model/hostClangAstDumper.ts";
import { BundledLibraryRegistry } from "../../src/libraries/bundledLibraries.js";
import { LibraryList } from "../../src/libraries/libraryList.js";

test("default libraries are the base library", () => {
  expect(LibraryList.defaultIds).toEqual(["base"]);
  expect(new LibraryList().ids).toEqual(["base"]);
});

test("enumerates every block from each library in the list", async () => {
  const bundled = BundledLibraryRegistry.shared.require("base");
  registerAppAssets(bundled.assets());
  const clang = await Library.load("base.json");
  const listed = new LibraryList(["base"]).load();

  expect(listed.map((library) => library.id)).toEqual(["base"]);
  const enumerated = listed[0]?.palette.getBlocks().map((block) => block.id).sort();
  const expected = clang.palette.getBlocks().map((block) => block.id).sort();
  expect(enumerated).toEqual(expected);
  expect(expected.length).toBeGreaterThan(0);
  for (const id of expected) {
    expect(listed[0]?.palette.getBlock(id)?.title).toBe(clang.palette.getBlock(id)?.title);
    expect(listed[0]?.palette.getBlock(id)?.category).toBe(clang.palette.getBlock(id)?.category);
  }
});
