import { Diagram, Library, type PackageManifest } from "core";
import { expect, test } from "vitest";
import { BlockConfiguration, ConfigControl } from "../../src/view/diagram/blockConfiguration.js";
import { PlacedBlock } from "../../src/view/diagram/diagramBlockFrame.js";

const manifest: PackageManifest = {
  id: "demo",
  name: "Demo",
  icon: "library-base.svg",
  location: "memory:demo",
};

function library(): Library {
  return Library.fromManifest(manifest, {
    blocks: {
      ConstF32: {
        ns: ["push", "f32", "sources"],
        title: "Constant",
        inputs: { downstream: { type: "f32", vector: true } },
        conf: {
          value: {
            type: "f32",
            title: "Value",
            description: "Value emitted by the constant source.",
            default: 1,
            control: { type: "number" },
          },
        },
      },
      ScopeF32: {
        ns: ["push", "f32", "sinks"],
        title: "Scope",
        outputs: { channels: { type: "f32", vector: true } },
        conf: {
          period: {
            type: "u32",
            title: "Period",
            description: "Observation update period in seconds.",
            default: 60,
            control: { type: "slider", min: 1, max: 3600, step: 1 },
          },
        },
      },
      GpioInF32: {
        ns: ["push", "f32", "sources"],
        title: "GPIO Input",
        inputs: { pins: { type: "f32", vector: true } },
        conf: {
          pins: {
            type: "auto",
            title: "Pins",
            description: "GPIO pin indices.",
            default: [0],
            control: { type: "text" },
          },
        },
      },
      CosF32: {
        ns: ["push", "f32", "transformers"],
        title: "cos",
        inputs: { downstream: { type: "f32", vector: true } },
        outputs: { consumer: { type: "f32" } },
      },
    },
  });
}

test("opens configuration only for blocks that declare parameters", () => {
  const diagram = new Diagram("diagram", "Diagram", library().palette);
  const constant = diagram.addBlock("ConstF32", { x: 0, y: 0 });
  const cosine = diagram.addBlock("CosF32", { x: 20, y: 0 });
  expect(BlockConfiguration.of(constant)?.fields.map((field) => field.id)).toEqual(["value"]);
  expect(BlockConfiguration.of(cosine)).toBeUndefined();
  expect(PlacedBlock.from(constant).configurable).toBe(true);
  expect(PlacedBlock.from(cosine).configurable).toBe(false);
});

test("stores edited numbers and lists and omits values that match the default", () => {
  const diagram = new Diagram("diagram", "Diagram", library().palette);
  const constant = diagram.addBlock("ConstF32", { x: 0, y: 0 });
  const scope = diagram.addBlock("ScopeF32", { x: 40, y: 0 });
  const gpio = diagram.addBlock("GpioInF32", { x: 80, y: 0 });
  const value = BlockConfiguration.of(constant)!.fields[0]!;
  const period = BlockConfiguration.of(scope)!.fields[0]!;
  const pins = BlockConfiguration.of(gpio)!.fields[0]!;

  expect(value.text).toBe("1");
  expect(value.control.kind).toBe("number");
  expect(period.control.kind).toBe("slider");
  expect(ConfigControl.from(scope.definition.getConfig("period")!).kind).toBe("slider");
  expect(value.commit("4.5")).toBe(true);
  expect(constant.getConf("value")).toBe(4.5);
  expect(constant.toJSON().conf).toEqual({ value: 4.5 });
  expect(value.commit("1")).toBe(true);
  expect(constant.toJSON().conf).toBeUndefined();
  expect(value.commit("nope")).toBe(false);
  expect(constant.getConf("value")).toBe(1);

  expect(period.commit("10")).toBe(true);
  expect(scope.toJSON().conf).toEqual({ period: 10 });
  expect(period.commit("0")).toBe(false);
  expect(scope.getConf("period")).toBe(10);

  expect(pins.text).toBe("0");
  expect(pins.commit("0, 2")).toBe(true);
  expect(gpio.getConf("pins")).toEqual([0, 2]);
  expect(pins.commit("a")).toBe(false);
  expect(gpio.getConf("pins")).toEqual([0, 2]);
});
