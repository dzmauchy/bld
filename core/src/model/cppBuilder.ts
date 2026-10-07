/** Generates C++ using the release metadata and core diagram wiring contract. */
import { ClangAstDumper, ClangDumpResult, ClangTranslationUnit, type ICppCompiler } from "cpp";
import { Diagram, DiagramPortTypes } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";
import type { Connection } from "./connection";
import type { PortEndpoint } from "./endpoint";
import type { PortDefinition } from "./blockDefinition";
import { InferredPortType } from "./inferredPortType";
import { browserHost } from "./browserHost";

export type { ICppCompiler };
export abstract class DiagramSourceBuilder {
  abstract build(diagram: Diagram): Map<string, string>;
}

export interface DiagramDiagnostic {
  severity: "error" | "warning" | "note";
  message: string;
  blockId?: string;
  inputId?: string;
  outputId?: string;
  connectionId?: string;
  configId?: string;
  from?: ReturnType<PortEndpoint["toJSON"]>;
  to?: ReturnType<PortEndpoint["toJSON"]>;
}

export class DiagramAnalysis {
  constructor(readonly ok: boolean, readonly types: DiagramPortTypes, readonly diagnostics: DiagramDiagnostic[]) {}

  assignTo(diagram: Diagram): void {
    for (const block of diagram.getBlocks()) {
      for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
        const diagnostics = this.diagnostics.filter((diagnostic) => {
          if (diagnostic.from || diagnostic.to) {
            return [diagnostic.from, diagnostic.to].some((endpoint) =>
              endpoint?.block === block.id && endpoint.port.type === port.direction && endpoint.port.id === port.id,
            );
          }
          if (diagnostic.blockId !== block.id) return false;
          if (!diagnostic.inputId && !diagnostic.outputId) return true;
          return (port.direction === "input" ? diagnostic.inputId : diagnostic.outputId) === port.id;
        });
        port.assignAnalysis(this.types.get(block.id, port.direction, port.id), diagnostics);
      }
    }
  }

  toJSON() {
    return { ok: this.ok, diagnostics: this.diagnostics, ports: this.types.entries().map(({ inferred, ...port }) => ({
      ...port, type: inferred.qualType, canonicalType: inferred.desugaredQualType,
      vector: inferred.isVector, vectorLength: inferred.vectorLength,
    })) };
  }
}

export class CppDiagramBuilder extends DiagramSourceBuilder {
  constructor(
    private readonly libraryFiles: Record<string, string> = ClangAstDumper.libraryFiles,
  ) { super(); }

  override build(diagram: Diagram): Map<string, string> {
    const files = new Map(Object.entries(this.libraryFiles));
    files.set("wasm_host.hpp", browserHost);
    files.set("diagram.cpp", this.emitDiagram(diagram));
    return files;
  }

  emitDiagram(diagram: Diagram): string {
    const blocks = diagram.getBlocks();
    const connections = diagram.getConnections();
    const order = this.order(blocks, connections);
    const index = (id: string) => blocks.findIndex((block) => block.id === id);
    const headers = Object.keys(this.libraryFiles).filter((name) => /\.(h|hpp|hh|hxx)$/.test(name)).sort();
    const lines = [
      // The pinned clang-wasm loop vectorizer stalls on the GPIO factory.
      // Load its dependencies first so only GPIO declarations get optnone.
      ...(headers.includes("base/gpio_in.hpp") ? [
        '#include <core/hal.hpp>', '#pragma clang optimize off',
        '#include <base/gpio_in.hpp>', '#pragma clang optimize on',
      ] : []),
      ...headers.map((name) => `#include <${name}>`),
      '#include "wasm_host.hpp"',
      ...JSON.stringify(diagram.toJSON(), null, 2).split("\n").map((line) => `// ${line}`),
      'extern "C" void mount() {',
    ];
    for (const block of order) {
      const i = index(block.id);
      const factory = `::${block.definition.cppFactory}`;
      const args = [`${i}u`];
      const properties = [...block.definition.config.values()];
      const last = properties.findLastIndex((property) => block.getConf(property.id) !== undefined);
      properties.slice(0, last + 1).forEach((property, parameterIndex) => {
        const value = block.getConf(property.id);
        if (value === undefined) throw new Error(`Missing configuration property "${property.id}"`);
        const values = Array.isArray(value) ? value : [value];
        const argument = `config_${i}_${property.id}`;
        lines.push(`#line 1 "${argument}"`,
          `auto ${argument} = core::config_arg<${parameterIndex}>(${factory}${values.length ? ", " : ""}${values.map(configLiteral).join(", ")});`);
        args.push(`core::detail::move(${argument})`);
      });
      lines.push(`#line 1 "block_${i}"`, `static auto b${i} = ${factory}(${args.join(", ")});`,
        `auto i${i} = core::block_inputs(b${i});`);
      for (const port of block.getInputPorts()) {
        const incoming = connections.filter((c) => c.to.blockId === block.id && c.to.portId === port.id);
        const input = `input_${i}_${port.id}`;
        const width = Math.max(0, ...incoming.map((c) => c.to.vectorIndex + 1));
        lines.push(`#line 1 "${input}"`,
          `auto ${input} = core::input_connections<${port.vector}, ${incoming.length}, ${width}>(i${i}.${port.id});`);
        for (const connection of incoming) {
          const source = index(connection.from.blockId);
          lines.push(`#line 1 "connection_${connections.indexOf(connection)}"`,
            `${input}.connect(${connection.to.vectorIndex}u, taken_${source}_${connection.from.portId}.at(${connection.from.vectorIndex}u));`);
        }
        lines.push(`#line 1 "${input}"`, `i${i}.${port.id} = ${input}.view();`, `auto port_${i}_input_${port.id} = i${i}.${port.id};`);
      }
      lines.push(`#line 1 "block_${i}"`, `static auto o${i} = core::bind_block(b${i}, core::detail::move(i${i}));`);
      for (const port of block.getOutputPorts()) {
        const width = Math.max(port.vector ? 0 : 1,
          ...connections.filter((c) => c.from.blockId === block.id && c.from.portId === port.id).map((c) => c.from.vectorIndex + 1));
        lines.push(`#line 1 "output_${i}_${port.id}"`, `auto port_${i}_output_${port.id} = o${i}.${port.id};`,
          `static auto taken_${i}_${port.id} = core::output_channels<${port.vector}, ${width}>(port_${i}_output_${port.id});`);
      }
    }
    lines.push("}", "");
    return lines.join("\n");
  }

  async analyze(diagram: Diagram, dumper = ClangAstDumper.defaultDumper()): Promise<DiagramAnalysis> {
    const snapshot = Diagram.fromJSON(structuredClone(diagram.toJSON()), diagram.palette);
    const analysis = this.validate(snapshot)
      ?? this.result(snapshot, await dumper.dumpAsync(this.build(snapshot), "diagram.cpp"));
    analysis.assignTo(diagram);
    return analysis;
  }

  analyzeSync(diagram: Diagram, dumper = ClangAstDumper.defaultDumper()): DiagramAnalysis {
    const analysis = this.validate(diagram)
      ?? this.result(diagram, dumper.dump(this.build(diagram), "diagram.cpp"));
    analysis.assignTo(diagram);
    return analysis;
  }

  /** Checks JSON configuration and metadata constraints without invoking clang. */
  validate(diagram: Diagram): DiagramAnalysis | undefined {
    const diagnostics: DiagramDiagnostic[] = [];
    for (const block of diagram.getBlocks()) {
      for (const [id, value] of Object.entries(block.getExplicitConfig())) {
        try {
          if (!block.definition.getConfig(id)) throw new Error(`Unknown configuration property "${id}"`);
          (Array.isArray(value) ? value : [value]).forEach(configLiteral);
        } catch (error) {
          diagnostics.push({ severity: "error", blockId: block.id, configId: id, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    const connections = diagram.getConnections();
    for (const connection of connections) {
      const source = diagram.getBlock(connection.from.blockId)!;
      const target = diagram.getBlock(connection.to.blockId)!;
      const output = source.definition.getOutput(connection.from.portId)!;
      const input = target.definition.getInput(connection.to.portId)!;
      let message: string | undefined;
      if ((!output.vector && connection.from.vectorIndex !== 0) || (!input.vector && connection.to.vectorIndex !== 0))
        message = "Scalar ports require vector index 0";
      for (const [block, port, endpoint] of [[source, output, connection.from], [target, input, connection.to]] as const) {
        const limit = this.channelLimit(block, port);
        if (limit !== undefined && endpoint.vectorIndex >= limit)
          message = `Port channel index exceeds the configured length of "${port.lengthBindConfId}"`;
      }
      if (!input.vector && connections.filter((other) => other.to.equals(connection.to)).length > 1)
        message = "Scalar inputs accept one connection";
      if (message) diagnostics.push({ severity: "error", message, blockId: target.id, inputId: input.id, outputId: output.id,
        connectionId: connection.id, from: connection.from.toJSON(), to: connection.to.toJSON() });
    }
    return diagnostics.length ? new DiagramAnalysis(false, new DiagramPortTypes(), diagnostics) : undefined;
  }

  /** Maps diagnostics from the single compilation to diagram elements. */
  compilationFailure(diagram: Diagram, error: unknown): DiagramAnalysis {
    const message = error instanceof Error ? error.message : String(error);
    const analysis = this.result(diagram, new ClangDumpResult(false, undefined, "", message));
    analysis.assignTo(diagram);
    return analysis;
  }

  private channelLimit(block: DiagramBlock, port: PortDefinition): number | undefined {
    const parameter = port.lengthBindConfId;
    if (!parameter) return undefined;
    const value = block.getConf(parameter);
    if (!Array.isArray(value)) return undefined;
    return Math.min(value.length, port.length?.max ?? Infinity);
  }

  private order(blocks: DiagramBlock[], connections: Connection[]): DiagramBlock[] {
    const ordered: DiagramBlock[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (block: DiagramBlock) => {
      if (visited.has(block.id)) return;
      if (visiting.has(block.id)) throw new Error(`Diagram has a cycle at block ${block.id}`);
      visiting.add(block.id);
      for (const c of connections.filter((c) => c.to.blockId === block.id)) {
        const source = blocks.find((b) => b.id === c.from.blockId);
        if (!source) throw new Error(`Missing block ${c.from.blockId}`);
        visit(source);
      }
      visiting.delete(block.id);
      visited.add(block.id);
      ordered.push(block);
    };
    blocks.forEach(visit);
    return ordered;
  }

  private result(diagram: Diagram, dump: ClangDumpResult): DiagramAnalysis {
    const types = new DiagramPortTypes();
    const unit = dump.ast ? ClangTranslationUnit.parse(dump.ast) : undefined;
    diagram.getBlocks().forEach((block, i) => {
      for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
        const type = unit?.varType(`port_${i}_${port.direction}_${port.id}`);
        if (!type || type.qualType === "auto") continue;
        const endpoints = diagram.getConnections().flatMap((c) => [c.from, c.to]).filter((e) => e.blockId === block.id && e.portType === port.direction && e.portId === port.id);
        const length = port.vector ? this.channelLimit(block, port) ?? Math.max(1, ...endpoints.map((e) => e.vectorIndex + 1)) : undefined;
        types.set(block.id, port.direction, port.id, new InferredPortType(type, port.vector, length));
      }
    });
    const diagnostics: DiagramDiagnostic[] = [];
    for (const line of dump.diagnostics.split("\n")) {
      const match = line.match(/^(.*?):\d+:\d+: (error|warning|note): (.*)$/);
      if (!match) continue;
      const [, file = "", severity, message = ""] = match;
      const diagnostic: DiagramDiagnostic = { severity: severity as DiagramDiagnostic["severity"], message };
      const connectionMatch = file.match(/^connection_(\d+)$/);
      const configMatch = file.match(/^config_(\d+)_(.*)$/);
      const blockMatch = file.match(/^(?:block|input|output)_(\d+)(?:_(.*))?$/);
      if (connectionMatch) {
        const c = diagram.getConnections()[Number(connectionMatch[1])];
        if (c) Object.assign(diagnostic, { blockId: c.to.blockId, inputId: c.to.portId, outputId: c.from.portId, connectionId: c.id, from: c.from.toJSON(), to: c.to.toJSON() });
      } else if (configMatch) {
        diagnostic.blockId = diagram.getBlocks()[Number(configMatch[1])]?.id;
        diagnostic.configId = configMatch[2];
      } else if (blockMatch) {
        diagnostic.blockId = diagram.getBlocks()[Number(blockMatch[1])]?.id;
        if (file.startsWith("input_")) diagnostic.inputId = blockMatch[2];
        if (file.startsWith("output_")) diagnostic.outputId = blockMatch[2];
      }
      diagnostics.push(diagnostic);
    }
    // Template failures point to the helper; their instantiation note carries the diagram location.
    for (let i = 0; i < diagnostics.length; i++) {
      const error = diagnostics[i]!;
      if (error.severity !== "error" || error.connectionId || error.configId) continue;
      for (let j = i + 1; j < diagnostics.length && diagnostics[j]!.severity !== "error"; j++) {
        const note = diagnostics[j]!;
        if (note.connectionId || note.configId) { Object.assign(error, { ...note, severity: error.severity, message: error.message }); break; }
      }
    }
    if (!dump.ok && !diagnostics.some((d) => d.severity === "error")) diagnostics.push({ severity: "error", message: dump.diagnostics || "Clang produced no AST" });
    return new DiagramAnalysis(dump.ok && Boolean(dump.ast), types, diagnostics);
  }
}

/** Emits JSON scalar literals; the library determines each C++ parameter type. */
function configLiteral(value: unknown): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Config values must be finite numbers or booleans");
  const text = String(value);
  return Object.is(value, -0) ? "-0.0" : /[.eE]/.test(text) ? text : `${text}.0`;
}
