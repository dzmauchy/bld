import { expect, test } from "vitest";
import { CppDiagramBuilder, Diagram, DiagramCompiler, Palette, PortEndpoint } from "core";
import type { CompilationPhaseEvent } from "cpp/compilationProgress.ts";
import { ClangFrontend } from "cpp/clang.ts";
import { CppWasmCompiler } from "cpp/compiler.ts";
import { WasmLinker } from "cpp/linker.ts";
import { SharedToolchainFileSystem } from "cpp/sharedFileSystem.ts";
import { DisposableToolFactory, writeClangOutputs } from "../toolchainFixture.ts";

test("diagram compilation emits AST/object in one clang invocation and links that object", async () => {
  const files = new SharedToolchainFileSystem();
  const clangFactory = new DisposableToolFactory(files, (_options, fs, args) => {
    const source = new TextDecoder().decode(fs.readFile("/work/diagram.cpp"));
    expect(source).toContain("core::config_arg<0>(::custom::Source,");
    expect(source).toContain("core::input_connections<false, 1, 1>");
    expect(source).not.toContain("bld_factory");
    writeClangOutputs(fs, args);
    return 0;
  });
  const wasm = new Uint8Array([0, 97, 115, 109]);
  const lldFactory = new DisposableToolFactory(files, (_options, fs, args) => {
    expect(args).toContain("/work/build/diagram.o");
    expect(fs.exists("/work/build/diagram.json")).toBe(true);
    fs.writeTree(args.at(-1)!, wasm);
    return 0;
  });
  const backend = new CppWasmCompiler(
    new ClangFrontend(clangFactory.create, "clang.wasm", files),
    new WasmLinker(lldFactory.create, "lld.wasm", files), "sysroot.tgz",
  );
  const palette = Palette.fromCatalog({
    Source: { cpp: "custom::Source", outputs: { data: { type: "auto" } },
      conf: { value: { type: "auto", default: 0 } } },
    Sink: { cpp: "custom::Sink", inputs: { data: { type: "auto" } } },
  }, {});
  const diagram = new Diagram("single", "Single execution", palette);
  const source = diagram.addBlock("Source", { x: 0, y: 0 }, "source", { value: 3.5 });
  diagram.addBlock("Sink", { x: 0, y: 0 }, "sink");
  diagram.connect(new PortEndpoint("source", "output", "data"), new PortEndpoint("sink", "input", "data"));
  const compiler = new DiagramCompiler({ cppCompiler: backend });
  const events: CompilationPhaseEvent[] = [];
  const unsubscribe = compiler.addPhaseListener(event => events.push(event));
  expect(await compiler.compile(diagram)).toEqual(wasm);
  expect(events).toEqual([
    { phase: "compilation", status: "active" },
    { phase: "compilation", status: "completed" },
    { phase: "linking", status: "active" },
    { phase: "linking", status: "completed" },
  ]);
  unsubscribe();
  expect(clangFactory.runs).toHaveLength(1);
  expect(lldFactory.runs).toHaveLength(1);
  source.setConf("value", 7.25);
  expect(await compiler.compile(diagram)).toEqual(wasm);
  expect(clangFactory.runs).toHaveLength(2);
  expect(lldFactory.runs).toHaveLength(2);
  expect(events).toHaveLength(4);

  const builder = new CppDiagramBuilder();
  const builderEvents: CompilationPhaseEvent[] = [];
  const listener = (event: CompilationPhaseEvent) => builderEvents.push(event);
  builder.addPhaseListener(listener);
  const ready = Promise.withResolvers<void>();
  const instantiated = Promise.withResolvers<void>();
  const session = { ready: true };
  const running = builder.run(diagram, backend, {
    async instantiate(bytes) {
      expect(bytes).toEqual(wasm);
      instantiated.resolve();
      await ready.promise;
      return session;
    },
  });
  await instantiated.promise;
  expect(builderEvents).toEqual([
    ...events, { phase: "running", status: "active" },
  ]);
  ready.resolve();
  expect(await running).toBe(session);
  expect(builderEvents.at(-1)).toEqual({ phase: "running", status: "completed" });
  builder.removePhaseListener(listener);
  await builder.compile(diagram, backend);
  expect(builderEvents).toHaveLength(6);
});
