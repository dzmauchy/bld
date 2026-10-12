/**
 * Manual integration test comparing raw Clang JSON dumps with the main-file AST
 * retained by the streaming reader across diagram scales.
 */

import { beforeAll, describe, expect, test } from "vitest";
import { fstatSync, readSync } from "node:fs";
import { ClangDumpResult } from "cpp";
import { HostClangAstDumper } from "cpp/hostClangAstDumper.ts";
import { CppDiagramBuilder } from "core/model/cppBuilder.ts";
import { Diagram } from "core/model/diagram.ts";
import { PortEndpoint } from "core/model/endpoint.ts";
import { Library } from "core/model/library.ts";

export interface IDiagramAstMeasurement {
  readonly diagramName: string;
  readonly sourceBytes: number;
  readonly sourceLines: number;
  readonly astJsonBytes: number;
  readonly astJsonMb: number;
  readonly totalNodeCount: number;
  readonly mountNodeCount: number;
  readonly retainedJsonBytes: number;
  readonly retainedNodeCount: number;
  readonly discardedNodeCount: number;
  readonly expansionRatio: number;
  readonly discardedNodeRatio: number;
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

export class MeasuringClangAstDumper extends HostClangAstDumper {
  private readonly _measurements: IDiagramAstMeasurement[] = [];
  private _currentDiagramName = "";
  private rawJsonBytes = 0;
  private rawNodeStats = { total: 0, mount: 0 };

  get measurements(): readonly IDiagramAstMeasurement[] {
    return this._measurements;
  }

  setContext(diagramName: string): void {
    this._currentDiagramName = diagramName;
  }

  protected override readAst(output: number, mainFile: string): unknown {
    // Full JSON materialization is limited to this manual profile. Production
    // continues to stream the file and retain only main-file declarations.
    const bytes = Buffer.alloc(fstatSync(output).size);
    let position = 0;
    while (position < bytes.length) {
      const count = readSync(output, bytes, position, bytes.length - position, position);
      if (count === 0) throw new Error("Incomplete Clang AST dump file");
      position += count;
    }
    this.rawJsonBytes = bytes.length;
    this.rawNodeStats = AstNodeHierarchyCounter.count(JSON.parse(bytes.toString("utf8")));
    return super.readAst(output, mainFile);
  }

  override dump(files: Map<string, string>, mainFile: string): ClangDumpResult {
    const source = files.get(mainFile) ?? "";
    const sourceBytes = Buffer.byteLength(source, "utf8");
    const sourceLines = source.split("\n").length;

    this.rawJsonBytes = 0;
    this.rawNodeStats = { total: 0, mount: 0 };
    const result = super.dump(files, mainFile);
    const astJsonBytes = this.rawJsonBytes;
    const astJsonMb = Number((astJsonBytes / (1024 * 1024)).toFixed(2));

    const retainedNodeStats = result.ast
      ? AstNodeHierarchyCounter.count(result.ast)
      : { total: 0, mount: 0 };

    const nodeStats = this.rawNodeStats;
    const retainedJsonBytes = Buffer.byteLength(JSON.stringify(result.ast) ?? "", "utf8");
    const discardedNodeCount = nodeStats.total - retainedNodeStats.total;
    const expansionRatio = sourceBytes > 0 ? Number((astJsonBytes / sourceBytes).toFixed(1)) : 0;
    const discardedNodeRatio = nodeStats.total > 0 ? discardedNodeCount / nodeStats.total : 0;

    this._measurements.push({
      diagramName: this._currentDiagramName,
      sourceBytes,
      sourceLines,
      astJsonBytes,
      astJsonMb,
      totalNodeCount: nodeStats.total,
      mountNodeCount: nodeStats.mount,
      retainedJsonBytes,
      retainedNodeCount: retainedNodeStats.total,
      discardedNodeCount,
      expansionRatio,
      discardedNodeRatio,
    });

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
      "| Diagram | Source Size | Lines | Raw AST JSON (Bytes) | Raw AST JSON (MB) | Retained JSON (Bytes) | Raw AST Nodes | Retained Nodes | mount() Nodes | Discarded Nodes (%) | Expansion |",
    );
    console.log(
      "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );

    for (const m of measurements) {
      const discardedPct = (m.discardedNodeRatio * 100).toFixed(2);
      console.log(
        `| ${m.diagramName} | ${m.sourceBytes.toLocaleString()} B | ${m.sourceLines} | ${m.astJsonBytes.toLocaleString()} B | **${m.astJsonMb} MB** | ${m.retainedJsonBytes.toLocaleString()} B | ${m.totalNodeCount.toLocaleString()} | ${m.retainedNodeCount.toLocaleString()} | ${m.mountNodeCount.toLocaleString()} | ${discardedPct}% | **${m.expansionRatio.toLocaleString()}x** |`,
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
    measuringDumper = new MeasuringClangAstDumper();
  });

  test("measures raw AST size and verifies streaming retention across diagram scales", async () => {
    // 1. Single block diagram: ConstF32
    const singleBlockDiagram = new Diagram("single_block", "Single Block", library.palette);
    singleBlockDiagram.addBlock("ConstF32", { x: 0, y: 0 }, "c", { value: 42.0 });

    measuringDumper.setContext("Single Block (ConstF32)");
    const singleAnalysis = await builder.analyze(singleBlockDiagram, measuringDumper);
    expect(singleAnalysis.ok, JSON.stringify(singleAnalysis.diagnostics)).toBe(true);

    // 2. Connected diagram: ConstF32 -> ScopeF32
    const connectedDiagram = new Diagram("connected", "Connected", library.palette);
    connectedDiagram.addBlock("ScopeF32", { x: 0, y: 0 }, "s");
    connectedDiagram.addBlock("ConstF32", { x: 1, y: 0 }, "c", { value: 3.5 });
    connectedDiagram.connect(
      new PortEndpoint("s", "output", "channels", 0),
      new PortEndpoint("c", "input", "downstream", 0),
    );

    measuringDumper.setContext("Connected (ConstF32 -> ScopeF32)");
    const connectedAnalysis = await builder.analyze(connectedDiagram, measuringDumper);
    expect(connectedAnalysis.ok, JSON.stringify(connectedAnalysis.diagnostics)).toBe(true);

    // 3. Comprehensive diagram: all library palette blocks
    const fullDiagram = new Diagram("all_blocks", "All Palette Blocks", library.palette);
    for (const definition of library.palette.getBlocks()) {
      fullDiagram.addBlock(definition, { x: 0, y: 0 });
    }

    measuringDumper.setContext(`All ${library.palette.getBlocks().length} Palette Blocks`);
    const fullAnalysis = await builder.analyze(fullDiagram, measuringDumper);
    expect(fullAnalysis.ok, JSON.stringify(fullAnalysis.diagnostics)).toBe(true);

    // Print summary report
    reporter.report(measuringDumper.measurements);

    expect(measuringDumper.measurements).toHaveLength(3);
    for (const m of measuringDumper.measurements) {
      // Measure the emitted file, not stdout or the filtered in-memory AST.
      expect(m.astJsonBytes).toBeGreaterThan(15 * 1024 * 1024);
      expect(m.expansionRatio).toBeGreaterThan(3_000);
      expect(m.discardedNodeRatio).toBeGreaterThan(0.95);
      expect(m.mountNodeCount / m.totalNodeCount).toBeLessThan(0.05);
      expect(m.retainedJsonBytes).toBeGreaterThan(0);
      expect(m.retainedJsonBytes).toBeLessThan(m.astJsonBytes);
      expect(m.mountNodeCount).toBeGreaterThan(0);
      expect(m.retainedNodeCount).toBeGreaterThanOrEqual(m.mountNodeCount);
      expect(m.discardedNodeCount).toBeGreaterThan(0);
      expect(m.totalNodeCount).toBe(m.retainedNodeCount + m.discardedNodeCount);
    }
  });
});
