/**
 * Manual integration test measuring and proving that diagram-generated Clang ASTs
 * have huge sizes relative to their source representation.
 */

import { beforeAll, describe, expect, test } from "@rstest/core";
import { ClangAstDumper, ClangDumpResult } from "cpp";
import { CppDiagramBuilder } from "../../src/model/cppBuilder";
import { Diagram } from "../../src/model/diagram";
import { PortEndpoint } from "../../src/model/endpoint";
import { Library } from "../../src/model/library";

export interface IDiagramAstMeasurement {
  readonly diagramName: string;
  readonly dumpPhase: "probe" | "full";
  readonly sourceBytes: number;
  readonly sourceLines: number;
  readonly astJsonBytes: number;
  readonly astJsonMb: number;
  readonly totalNodeCount: number;
  readonly mountNodeCount: number;
  readonly headerNodeCount: number;
  readonly expansionRatio: number;
  readonly headerNodeRatio: number;
}

export class AstNodeHierarchyCounter {
  static count(astNode: unknown): { total: number; mount: number } {
    let total = 0;
    let mount = 0;

    const traverse = (node: unknown, insideMount: boolean): void => {
      if (!node || typeof node !== "object") return;
      total++;
      const currentIsMount =
        insideMount ||
        ((node as { kind?: string; name?: string }).kind === "FunctionDecl" &&
          (node as { kind?: string; name?: string }).name === "mount");

      if (currentIsMount) {
        mount++;
      }

      const inner = (node as { inner?: unknown[] }).inner;
      if (Array.isArray(inner)) {
        for (const child of inner) {
          traverse(child, currentIsMount);
        }
      }
    };

    traverse(astNode, false);
    return { total, mount };
  }
}

export class MeasuringClangAstDumper extends ClangAstDumper {
  private readonly _measurements: IDiagramAstMeasurement[] = [];
  private _currentDiagramName = "";
  private _currentPhase: "probe" | "full" = "probe";

  constructor(private readonly underlyingDumper: ClangAstDumper) {
    super();
  }

  get measurements(): readonly IDiagramAstMeasurement[] {
    return this._measurements;
  }

  setContext(diagramName: string, phase: "probe" | "full"): void {
    this._currentDiagramName = diagramName;
    this._currentPhase = phase;
  }

  override dump(files: Map<string, string>, mainFile: string): ClangDumpResult {
    const source = files.get(mainFile) ?? "";
    const sourceBytes = Buffer.byteLength(source, "utf8");
    const sourceLines = source.split("\n").length;

    const result = this.underlyingDumper.dump(files, mainFile);
    const astJsonBytes = Buffer.byteLength(result.stdout, "utf8");
    const astJsonMb = Number((astJsonBytes / (1024 * 1024)).toFixed(2));

    const nodeStats = result.ast
      ? AstNodeHierarchyCounter.count(result.ast)
      : { total: 0, mount: 0 };

    const headerNodeCount = nodeStats.total - nodeStats.mount;
    const expansionRatio = sourceBytes > 0 ? Number((astJsonBytes / sourceBytes).toFixed(1)) : 0;
    const headerNodeRatio = nodeStats.total > 0 ? headerNodeCount / nodeStats.total : 0;

    this._measurements.push({
      diagramName: this._currentDiagramName,
      dumpPhase: this._currentPhase,
      sourceBytes,
      sourceLines,
      astJsonBytes,
      astJsonMb,
      totalNodeCount: nodeStats.total,
      mountNodeCount: nodeStats.mount,
      headerNodeCount,
      expansionRatio,
      headerNodeRatio,
    });

    // Toggle for subsequent dump call in two-phase analysis
    this._currentPhase = "full";
    return result;
  }
}

export abstract class BaseAstReporter {
  abstract report(measurements: readonly IDiagramAstMeasurement[]): void;
}

export class MarkdownTableAstReporter extends BaseAstReporter {
  override report(measurements: readonly IDiagramAstMeasurement[]): void {
    console.log("\n### Diagram Clang AST Size Analysis Report");
    console.log(
      "| Diagram | Phase | Source Size | Lines | AST JSON (Bytes) | AST JSON (MB) | AST Nodes | mount() Nodes | Header Nodes (%) | Expansion |",
    );
    console.log(
      "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    );

    for (const m of measurements) {
      const headerPct = (m.headerNodeRatio * 100).toFixed(2);
      console.log(
        `| ${m.diagramName} | ${m.dumpPhase} | ${m.sourceBytes.toLocaleString()} B | ${m.sourceLines} | ${m.astJsonBytes.toLocaleString()} B | **${m.astJsonMb} MB** | ${m.totalNodeCount.toLocaleString()} | ${m.mountNodeCount.toLocaleString()} | ${headerPct}% | **${m.expansionRatio.toLocaleString()}x** |`,
      );
    }
  }
}

describe("Manual Profile: Diagram AST Size Evidence", () => {
  let library: Library;
  let builder: CppDiagramBuilder;
  let measuringDumper: MeasuringClangAstDumper;
  const reporter = new MarkdownTableAstReporter();

  beforeAll(async () => {
    library = await Library.load("base.json");
    builder = new CppDiagramBuilder(library.compilationModel.getFiles());
    measuringDumper = new MeasuringClangAstDumper(ClangAstDumper.defaultDumper());
  });

  test("verifies that generated AST JSON sizes are huge across diagram scales", async () => {
    // 1. Single block diagram: ConstF32
    const singleBlockDiagram = new Diagram("single_block", "Single Block", library.palette);
    singleBlockDiagram.addBlock("ConstF32", { x: 0, y: 0 }, "c", { value: 42.0 });

    measuringDumper.setContext("Single Block (ConstF32)", "probe");
    const singleAnalysis = await builder.analyze(singleBlockDiagram, measuringDumper);
    expect(singleAnalysis.ok).toBe(true);

    // 2. Connected diagram: ConstF32 -> ScopeF32
    const connectedDiagram = new Diagram("connected", "Connected", library.palette);
    connectedDiagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
    connectedDiagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 3.5 });
    connectedDiagram.connect(
      new PortEndpoint("s", "output", "channels", 0),
      new PortEndpoint("c", "input", "downstream", 0),
    );

    measuringDumper.setContext("Connected (ConstF32 -> ScopeF32)", "probe");
    const connectedAnalysis = await builder.analyze(connectedDiagram, measuringDumper);
    expect(connectedAnalysis.ok).toBe(true);

    // 3. Comprehensive diagram: All 22 library palette blocks
    const fullDiagram = new Diagram("all_blocks", "All Palette Blocks", library.palette);
    for (const definition of library.palette.getBlocks()) {
      fullDiagram.addBlock(definition, { x: 0, y: 0 });
    }

    measuringDumper.setContext("All 22 Palette Blocks", "probe");
    const fullAnalysis = await builder.analyze(fullDiagram, measuringDumper);
    expect(fullAnalysis.ok).toBe(true);

    // Print summary report
    reporter.report(measuringDumper.measurements);

    // Assert evidence of huge size
    for (const m of measuringDumper.measurements) {
      // Every single AST dump exceeds 15 MB of JSON text
      expect(m.astJsonBytes).toBeGreaterThan(15 * 1024 * 1024);
      // Source expands by more than 3,000x into AST JSON
      expect(m.expansionRatio).toBeGreaterThan(3_000);
      // Over 95% of AST nodes originate from included headers rather than diagram logic
      expect(m.headerNodeRatio).toBeGreaterThan(0.95);
      // Actual diagram mount() function accounts for less than 5% of AST nodes
      expect(m.mountNodeCount / m.totalNodeCount).toBeLessThan(0.05);
    }
  });
});
