import { expect, test } from "@rstest/core";
import config from "../../playwright.config.ts";

test("lists every Playwright test in CI logs", () => {
  expect(config.reporter).toBe("list");
});

test("runs the C++ browser tests with four workers", () => {
  expect(config.workers).toBe(4);
  expect(config.fullyParallel).toBe(true);
});
