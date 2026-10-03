/** Object-oriented test profiler orchestrating execution breakdown for diagram tests. */

import { expect } from "@playwright/test";
import type { CppSession } from "../fixtures/cpp.ts";
import { Diagram, PortEndpoint, type CppDiagramBuilder } from "../../../core/src/index.ts";
import type { IProfileSession } from "./session.ts";
import type { IProfileReporter } from "./reporter.ts";
import { ProfilingClangAstDumper } from "./astDumper.ts";

export interface DiagramTestDefinition {
  readonly name: string;
  createDiagram(palette: any): Diagram;
  verify(cpp: CppSession): Promise<void>;
}

export function connect(
  diagram: Diagram,
  fromId: string,
  _fromPort: string,
  fromVec: number,
  toId: string,
  _toPort: string,
  toVec: number,
): void {
  const source = diagram.getBlock(toId)!;
  const target = diagram.getBlock(fromId)!;
  const output = source.definition.getOutput("channels") ? "channels" : "consumer";
  const input = target.definition.getInput("pins") ? "pins" : "downstream";
  diagram.connect(
    new PortEndpoint(toId, "output", output, toVec),
    new PortEndpoint(fromId, "input", input, fromVec),
  );
}

export function createConstScopeTestDefinition(): DiagramTestDefinition {
  return {
    name: "ConstF32 writes to a scope channel",
    createDiagram: (palette: any) => {
      const diagram = new Diagram("const_scope", "const_scope", palette);
      diagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
      diagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 3.5 });
      connect(diagram, "c", "v", 0, "s", "sink", 0);
      return diagram;
    },
    verify: async (cpp: CppSession) => {
      const lastPin = await cpp.invoke("lastPin", [0, 0]);
      const hasPin = await cpp.invoke("hasPin", [0, 0]);
      expect(lastPin).toBe(3.5);
      expect(hasPin).toBe(1);
    },
  };
}

export abstract class BaseDiagramTestProfiler {
  constructor(
    protected readonly session: IProfileSession,
    protected readonly reporter: IProfileReporter,
  ) {}

  get profileSession(): IProfileSession {
    return this.session;
  }

  report(): void {
    this.reporter.report(this.session);
  }

  abstract execute(
    cpp: CppSession,
    builder: CppDiagramBuilder,
    palette: any,
  ): Promise<void>;
}

export class SingleDiagramTestProfiler extends BaseDiagramTestProfiler {
  constructor(
    session: IProfileSession,
    reporter: IProfileReporter,
    private readonly testDefinition: DiagramTestDefinition = createConstScopeTestDefinition(),
  ) {
    super(session, reporter);
  }

  override async execute(
    cpp: CppSession,
    builder: CppDiagramBuilder,
    palette: any,
  ): Promise<void> {
    const page = cpp.browserPage;

    // 1. Diagram Construction
    const diagram = this.session.measureSync(
      "1. Diagram Construction",
      "Instantiate Diagram and connect ports",
      () => this.testDefinition.createDiagram(palette),
      {
        blocks: 2,
        connections: 1,
      },
    );

    // 2. AST Analysis with breakdown
    const profilingDumper = new ProfilingClangAstDumper({
      dumpAst: (files, mainFile) =>
        page.evaluate(
          ({ files, mainFile }) => window.cpp.dumpAst(files, mainFile),
          { files: Object.fromEntries(files), mainFile },
        ),
    });

    const analysis = await this.session.measure(
      "2. AST Analysis",
      "builder.analyze (Probe AST dump + Full AST dump + Type inference)",
      async () => builder.analyze(diagram, profilingDumper),
    );

    expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);

    // Sub-metrics from AST dumper
    if (profilingDumper.records.length >= 2) {
      const probeRecord = profilingDumper.records[0]!;
      const fullRecord = profilingDumper.records[1]!;
      const totalAnalyze = this.session
        .metricsForPhase("2. AST Analysis")
        .find((m) => m.name.includes("builder.analyze"))?.durationMs ?? 0;
      const jsAnalysisOverhead = Math.max(
        0,
        totalAnalyze - (probeRecord.durationMs + fullRecord.durationMs),
      );

      this.session.record(
        "2. AST Analysis (Breakdown)",
        "Step 2a: Clang Probe AST Dump",
        probeRecord.durationMs,
        true,
        {
          mainFile: probeRecord.mainFile,
          files: probeRecord.fileCount,
          sourceChars: probeRecord.mainFileSizeChars,
          astJsonBytes: probeRecord.astJsonSizeChars,
        },
      );

      this.session.record(
        "2. AST Analysis (Breakdown)",
        "Step 2b: Clang Full Diagram AST Dump",
        fullRecord.durationMs,
        true,
        {
          mainFile: fullRecord.mainFile,
          files: fullRecord.fileCount,
          sourceChars: fullRecord.mainFileSizeChars,
          astJsonBytes: fullRecord.astJsonSizeChars,
        },
      );

      this.session.record(
        "2. AST Analysis (Breakdown)",
        "Step 2c: TypeScript Type Resolution & Validation",
        jsAnalysisOverhead,
        true,
      );
    }

    // 3. Code Generation
    const builtFiles = this.session.measureSync(
      "3. Code Generation",
      "builder.build (Emit C++ translation unit)",
      () => builder.build(diagram),
    );

    const diagramCpp = builtFiles.get("diagram.cpp") ?? "";
    this.session.record(
      "3. Code Generation (Artifacts)",
      "Emitted diagram.cpp source",
      0,
      true,
      {
        totalFiles: builtFiles.size,
        lines: diagramCpp.split("\n").length,
        bytes: diagramCpp.length,
      },
    );

    // 4. Wasm Compilation
    const wasmBytes = await this.session.measure(
      "4. Wasm Compilation",
      "cpp.compileOnly (clang++ C++ to .o, wasm-ld to .wasm)",
      async () => cpp.compileOnly(builtFiles),
    );

    this.session.record(
      "4. Wasm Compilation (Artifacts)",
      "Linked wasm module output",
      0,
      true,
      { wasmBytes },
    );

    // 5. Wasm Instantiation
    await this.session.measure(
      "5. Wasm Instantiation",
      "cpp.instantiateLast (WebAssembly.instantiate + constructors)",
      async () => cpp.instantiateLast(),
    );

    // 6. Invocations
    const lastPin = await this.session.measure(
      "6. Execution / Invocation",
      'cpp.invoke("lastPin", [0, 0])',
      async () => cpp.invoke("lastPin", [0, 0]),
      { channel: 0, index: 0 },
    );

    const hasPin = await this.session.measure(
      "6. Execution / Invocation",
      'cpp.invoke("hasPin", [0, 0])',
      async () => cpp.invoke("hasPin", [0, 0]),
      { channel: 0, index: 0 },
    );

    // 7. Verification
    await this.session.measure(
      "7. Verification",
      "Assert lastPin == 3.5 and hasPin == 1",
      async () => {
        expect(lastPin).toBe(3.5);
        expect(hasPin).toBe(1);
      },
    );
  }
}
