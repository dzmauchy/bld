import { expect, test } from "@rstest/core";
import config from "../../playwright.config.ts";

test("lists every Playwright test in CI logs", () => {
  expect(config.reporter).toBe("list");
});
