import { expect, test } from "vitest";
import { Library, type PackageManifest } from "core";
import baseManifest from "core/assets/base.json?raw";
import "core/model/hostClangAstDumper.ts";
import { LibraryList } from "../../src/libraries/libraryList.js";

test("default libraries are the base library", () => {
  expect(LibraryList.defaultIds).toEqual(["base"]);
  expect(new LibraryList().ids).toEqual(["base"]);
});

test("enumerates every block from each library in the list", async () => {
  const clang = await Library.load(JSON.parse(baseManifest) as PackageManifest);
  const listed = await new LibraryList(["base"]).load();

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
