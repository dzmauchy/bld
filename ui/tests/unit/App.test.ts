import { expect, test } from "vitest";
import { modelAssetFiles } from "core";
import { App } from "../../src/App.js";
import { modelAssets } from "../../src/modelAssets.js";

test("App renders add(2, 2) and model asset titles", () => {
  expect(App()).toBe([
    "4",
    "basic.ts Basic types",
    "context.ts",
    "diagram.ts Diagram 1",
    "gpio.ts GPIO",
    "messages.ts",
    "push.ts Push stream",
  ].join("\n"));
});

test("loads every core model file as a source asset", () => {
  expect(Object.keys(modelAssets).sort()).toEqual([...modelAssetFiles].sort());
  expect(modelAssets["basic.ts"]).toContain("export namespace basic");
  expect(modelAssets["context.ts"]).toContain("export interface ExecutionContext");
  expect(modelAssets["diagram.ts"]).toContain("export function diagram");
  expect(modelAssets["gpio.ts"]).toContain("export namespace gpio");
  expect(modelAssets["messages.ts"]).toContain("export type Message");
  expect(modelAssets["push.ts"]).toContain("export namespace push");
});
