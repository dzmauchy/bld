import { expect, test } from "vitest";
import { Diagram, Library, InputPortEndpoint, OutputPortEndpoint } from "core";
import { DiagramConnectionValidator } from "ui/view/run/diagramConnectionValidator.ts";

function diagram(): Diagram {
  const library = Library.fromManifest({ id: "demo", name: "Demo", icon: "", location: "memory:demo" }, {
    blocks: {
      Sink: { outputs: { channels: { type: "f32", vector: true } } },
      Transform: { inputs: { downstream: { type: "f32" } }, outputs: { consumer: { type: "f32" } } },
      Source: { inputs: { downstream: { type: "f32" } } },
      Optional: {
        inputs: { channels: { type: "f32", vector: true, length: { parameter: "channels" } } },
        conf: { channels: { type: "auto", default: [] } },
      },
    },
  });
  return new Diagram("diagram", "Diagram", library.palette);
}

test("detects an unfed transformer branch even when a different sink channel is connected to a source", () => {
  const model = diagram();
  model.addBlock("Sink", { x: 0, y: 0 }, "sink");
  model.addBlock("Transform", { x: 100, y: 0 }, "transform");
  model.addBlock("Source", { x: 100, y: 100 }, "source");
  model.connect(new OutputPortEndpoint("sink", "channels", 0), new InputPortEndpoint("transform", "downstream"));
  model.connect(new OutputPortEndpoint("sink", "channels", 1), new InputPortEndpoint("source", "downstream"));
  const validator = new DiagramConnectionValidator();
  expect(() => validator.validate(model)).toThrow("Transform: port “consumer” has no connection.");
  model.addBlock("Source", { x: 200, y: 0 }, "upstream");
  model.connect(new OutputPortEndpoint("transform", "consumer"), new InputPortEndpoint("upstream", "downstream"));
  expect(() => validator.validate(model)).not.toThrow();
});

test("permits explicitly empty configured channels and rejects an empty diagram", () => {
  const model = diagram();
  const validator = new DiagramConnectionValidator();
  expect(() => validator.validate(model)).toThrow("Add and connect blocks");
  const optional = model.addBlock("Optional", { x: 0, y: 0 });
  expect(() => validator.validate(model)).not.toThrow();
  optional.setConf("channels", 0);
  expect(() => validator.validate(model)).not.toThrow();
  optional.setConf("channels", 2);
  expect(() => validator.validate(model)).toThrow("channels” has no connection.");
});
