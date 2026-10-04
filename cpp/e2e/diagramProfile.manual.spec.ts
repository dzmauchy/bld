import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type CppSession } from "./fixtures/cpp.ts";
import "../../core/tests/nodeFileFetch.ts";
import {
  CppDiagramBuilder,
  Diagram,
  Library,
  registerAppAssets,
} from "../../core/src/index.ts";
import "../src/hostClangAstDumper.ts";
import { ExecutionProfileSession } from "./profiling/session.ts";
import { MarkdownTableProfileReporter } from "./profiling/reporter.ts";
import { SingleDiagramTestProfiler } from "./profiling/diagramProfiler.ts";

const here = dirname(fileURLToPath(import.meta.url));
const coreAssets = join(here, "../../core/assets");

registerAppAssets({
  "base.json": readFileSync(join(coreAssets, "base.json"), "utf8"),
});

let builder: CppDiagramBuilder;
let palette: Awaited<ReturnType<typeof Library.load>>["palette"];
let libraryLoadDurationMs = 0;
let builderInitDurationMs = 0;

test.beforeAll(async () => {
  const libStart = performance.now();
  const library = await Library.load("base.json");
  libraryLoadDurationMs = performance.now() - libStart;
  palette = library.palette;

  const builderStart = performance.now();
  builder = new CppDiagramBuilder(library.compilationModel.getFiles());
  builderInitDurationMs = performance.now() - builderStart;
});

test.afterEach(async ({ cpp }) => {
  await cpp.expectWorkersReused();
});

test("Profile: ConstF32 writes to a scope channel", async ({ cpp }) => {
  const reporter = new MarkdownTableProfileReporter();
  const pchStart = performance.now();
  await cpp.precompileHeaders(builder.build(new Diagram("headers", "Headers", palette)));
  const pchDurationMs = performance.now() - pchStart;

  // Print Setup & Warmup Profile
  console.log(`\n### Environment Initialization & Warmup Profile`);
  console.log(`| Setup Step | Duration (ms) | Details |`);
  console.log(`| :--- | :---: | :--- |`);
  console.log(`| Library.load("base.json") | ${libraryLoadDurationMs.toFixed(2)} ms | Parsed metadata & compilation model |`);
  console.log(`| CppDiagramBuilder init | ${builderInitDurationMs.toFixed(2)} ms | Initialized builder with library files |`);
  console.log(`| Browser & Workers Warmup | ${cpp.warmupDurationMs.toFixed(2)} ms | Navigation, ServiceWorker claim, Clang/LLD boot, sysroot unpack |`);
  console.log(`| Precompiled headers | ${pchDurationMs.toFixed(2)} ms | Prepared the same header bundle as the browser analyzer |`);

  // 1. Pass 1: Cold Run
  const coldSession = new ExecutionProfileSession(
    "Pass 1: Cold Run ('ConstF32 writes to a scope channel')",
  );
  const coldProfiler = new SingleDiagramTestProfiler(coldSession, reporter);
  await coldProfiler.execute(cpp, builder, palette);
  coldProfiler.report();

  // 2. Pass 2: Warm Run (Demonstrating performance when workers & JIT are warm)
  const warmSession = new ExecutionProfileSession(
    "Pass 2: Warm Run ('ConstF32 writes to a scope channel')",
  );
  const warmProfiler = new SingleDiagramTestProfiler(warmSession, reporter);
  await warmProfiler.execute(cpp, builder, palette);
  warmProfiler.report();

  // 3. Comparison Summary
  const coldTotal = coldSession.totalDurationMs();
  const warmTotal = warmSession.totalDurationMs();
  const speedup = warmTotal > 0 ? (coldTotal / warmTotal).toFixed(2) : "N/A";

  console.log(`\n### Performance Comparison Summary`);
  console.log(`| Execution Run | Total Duration (ms) | Speedup Ratio |`);
  console.log(`| :--- | :---: | :---: |`);
  console.log(`| Pass 1 (Cold) | ${coldTotal.toFixed(2)} ms | 1.00x |`);
  console.log(`| Pass 2 (Warm) | ${warmTotal.toFixed(2)} ms | ${speedup}x |`);

  expect(coldTotal).toBeGreaterThan(0);
  expect(warmTotal).toBeGreaterThan(0);
});
