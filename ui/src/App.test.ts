import { expect, test } from "vitest";
import { App } from "./App.js";

test("App renders add(2, 2)", () => {
  expect(App()).toBe("4");
});
