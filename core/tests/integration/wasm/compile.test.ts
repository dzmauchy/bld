import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { BrowserCompiler, Diagram, Library, PortEndpoint } from "../../../src";
import { importAssembly } from "runtime";
import { compileDiagram } from "runtime/compile.ts";
import { instantiateWasm, defaultEnvBindings } from "runtime/run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const baseManifest = readFileSync(join(here, "../../../assets/base.json"), "utf8");
const assemblyUrl = pathToFileURL(join(here, "../../../../base/dist/assembly.js")).href;

function constToScopeDiagram() {
  const diagram = new Diagram("pin", "pin");
  const scope = diagram.addBlock("scope_f32", { x: 0, y: 0 }, "s");
  const constant = diagram.addBlock("const_f32", { x: 1, y: 0 }, "c", { v: 3.5 });
  diagram.connect(
    new PortEndpoint(constant.id, "input", "v", 0),
    new PortEndpoint(scope.id, "output", "sink", 0),
  );
  return diagram;
}

describe("binaryen compile and host bindings", () => {
  test("compiled diagram calls sendPinF32", async () => {
    await Library.load("base.json");
    const diagram = constToScopeDiagram();
    const wasm = new BrowserCompiler().compile(diagram);
    const calls: number[] = [];
    const instance = await instantiateWasm(wasm, {
      ...defaultEnvBindings(),
      sendPinF32(blockId: number, pin: number, value: number) {
        calls.push(blockId, pin, value);
      },
    });
    const tickThenObserve = instance.exports.tickThenObserve;
    expect(typeof tickThenObserve).toBe("function");
    (tickThenObserve as () => void)();
    expect(calls).toContain(3.5);
  });

  test("compileDiagram loads library.schema.json URLs and emits browser wasm", async () => {
    await Library.load("base.json");
    const files: Record<string, string> = {
      "https://libs.example/base.json": baseManifest,
    };
    const imported: string[] = [];
    const wasm = await compileDiagram({
      diagram: constToScopeDiagram().toJSON(),
      libraries: ["https://libs.example/base.json"],
      profile: "browser",
      fetchText: async (url) => {
        const content = files[url];
        if (!content) throw new Error(`missing ${url}`);
        return content;
      },
      importModule: async (url) => {
        imported.push(url);
        expect(url).toBe("https://libs.example/assembly.js");
        return importAssembly(assemblyUrl);
      },
    });
    expect(imported).toEqual(["https://libs.example/assembly.js"]);
    const instance = await instantiateWasm(wasm);
    (instance.exports.tickThenObserve as () => void)();
    const lastPin = instance.exports.lastPin as (blockId: number, pin: number) => number;
    expect(lastPin(0, 0)).toBe(3.5);
  });
});
