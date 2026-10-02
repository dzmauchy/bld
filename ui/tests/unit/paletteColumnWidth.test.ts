import { expect, test } from "@rstest/core";
import { PaletteColumnWidth } from "../../src/view/palette/paletteColumnWidth.js";

test("palette column is the wider of the titles and two buttons, plus slack", () => {
  expect(new PaletteColumnWidth(181.75, 136.78125, 1.6).pixels()).toBeCloseTo(183.35);
  expect(new PaletteColumnWidth(100, 136.78125, 1.6).pixels()).toBeCloseTo(138.38125);
  expect(new PaletteColumnWidth(0, 0, 0.1).pixels()).toBeCloseTo(0.1);
});
