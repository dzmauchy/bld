import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";
import { CppDiagramBuilder, Diagram, DiagramCompiler, Library, PortEndpoint } from "core";
import { CppWasmCompiler } from "cpp/compiler.ts";
import type { CompilationPhaseEvent } from "cpp/compilationProgress.ts";
import { execute, serveToolchain } from "../toolchain.ts";

let assets: Awaited<ReturnType<typeof serveToolchain>>;
let library: Library;
let backend: CppWasmCompiler;
beforeAll(async () => {
  assets = await serveToolchain();
  backend = new CppWasmCompiler(assets.assetUrl);
  const manifest = JSON.parse(await readFile(new URL("../../../core/assets/base.json", import.meta.url), "utf8"));
  library = await Library.load(manifest);
}, 120_000);
afterAll(async () => { await assets?.close(); });

function diagram() {
  const diagram = new Diagram("single", "Single execution", library.palette);
  diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "scope");
  const source = diagram.addBlock("ConstF32", { x: 100, y: 0 }, "source", { value: 3.5 });
  diagram.connect(new PortEndpoint("scope", "output", "channels"), new PortEndpoint("source", "input", "downstream"), "wire");
  return { diagram, source };
}

async function instantiate(wasm: Uint8Array) {
  const exports = await execute(wasm);
  (exports.start as () => void)();
  return exports;
}

const compilationEvents = [
  { phase: "compilation", status: "active" }, { phase: "compilation", status: "completed" },
  { phase: "linking", status: "active" }, { phase: "linking", status: "completed" },
];

test("generated diagram C++ compiles, links, runs, and updates a real scope value", async () => {
  const { diagram: program, source } = diagram();
  const compiler = new DiagramCompiler({ files: library.compilationModel.getFiles(), cppCompiler: backend });
  const events: CompilationPhaseEvent[] = [];
  const unsubscribe = compiler.addPhaseListener(event => events.push(event));
  const first = await instantiate(await compiler.compile(program));
  expect((first.lastPin as (block: number, pin: number) => number)(0, 0)).toBe(3.5);
  expect(events).toEqual(compilationEvents);
  unsubscribe();
  source.setConf("value", 7.25);
  const changed = await instantiate(await compiler.compile(program));
  expect((changed.lastPin as (block: number, pin: number) => number)(0, 0)).toBe(7.25);
  expect(events).toHaveLength(4);

  const builder = new CppDiagramBuilder(library.compilationModel.getFiles());
  const builderEvents: CompilationPhaseEvent[] = [];
  const listener = (event: CompilationPhaseEvent) => builderEvents.push(event);
  builder.addPhaseListener(listener);
  const running = await builder.run(program, backend, { instantiate });
  expect((running.lastPin as (block: number, pin: number) => number)(0, 0)).toBe(7.25);
  expect(builderEvents).toEqual([
    ...compilationEvents, { phase: "running", status: "active" }, { phase: "running", status: "completed" },
  ]);
  builder.removePhaseListener(listener);
  await builder.compile(program, backend);
  expect(builderEvents).toHaveLength(6);
});

test("real compiler errors identify the connection and a successful edit clears them", async () => {
  const program = new Diagram("incompatible", "Incompatible", library.palette);
  program.addBlock("ScopeF64", { x: 0, y: 0 }, "scope");
  program.addBlock("ConstF32", { x: 100, y: 0 }, "source");
  program.connect(new PortEndpoint("scope", "output", "channels"), new PortEndpoint("source", "input", "downstream"), "wire");
  const compiler = new DiagramCompiler({ files: library.compilationModel.getFiles(), cppCompiler: backend });
  const failure = await compiler.compile(program).catch(error => error);
  expect(failure.diagnostics).toContainEqual(expect.objectContaining({ connectionId: "wire", blockId: "source", inputId: "downstream" }));
  expect(program.getBlock("source")?.getInputPorts()[0]?.hasError).toBe(true);
  program.disconnect("wire");
  program.removeBlock("scope");
  program.addBlock("ScopeF32", { x: 0, y: 0 }, "scope");
  program.connect(new PortEndpoint("scope", "output", "channels"), new PortEndpoint("source", "input", "downstream"), "wire");
  expect(await compiler.compile(program)).toBeInstanceOf(Uint8Array);
  expect(program.getBlock("source")?.getInputPorts()[0]?.hasError).toBe(false);
});
