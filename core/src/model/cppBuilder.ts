/** Generates one C++ program for both type analysis and compilation. */
import { ClangAstDumper, ClangTranslationUnit, ClangQualType, CppTypeNames, type ClangAstJson, type ClangDumpResult, type ICppCompiler } from "cpp";
import { Diagram, DiagramPortTypes } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";
import type { Connection } from "./connection";
import type { PortEndpoint } from "./endpoint";
import { ConfigPropertyDefinition } from "./blockDefinition";
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

const helpers = `
template <typename T> auto bld_port(T value, unsigned index) {
  if constexpr (requires { value.size(); value[index]; }) return value[index];
  else return value;
}
template <typename T, typename V> void bld_connect(T& input, unsigned index, V value) {
  if constexpr (requires { input.push_back(value); }) input.push_back(value);
  else if constexpr (requires { input[0].push_back(value); }) {
    while (input.size() <= index) input.emplace_back();
    input[index].push_back(value);
  } else input = value;
}
`;

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

  emitDiagram(diagram: Diagram, probe = false): string {
    const blocks = diagram.getBlocks();
    const connections = probe ? [] : diagram.getConnections();
    const order = this.order(blocks, connections);
    const index = (id: string) => blocks.findIndex((block) => block.id === id);
    const lines = [
      ...Object.keys(this.libraryFiles).filter((name) => /\.(h|hpp|hh|hxx)$/.test(name)).sort().map((name) => `#include <${name}>`),
      '#include "wasm_host.hpp"', helpers,
      // Explicit local instantiations keep constructor metadata visible in PCH-backed ASTs.
      ...(probe ? [...new Set(blocks.map((block) => block.definition.cppClass))].filter((cpp) => cpp.endsWith("<>")).map((cpp) => {
        const split = cpp.lastIndexOf("::");
        return split < 0 ? `template class ${cpp};` : `namespace ${cpp.slice(0, split)} { template class ${cpp.slice(split + 2)}; }`;
      }) : []),
      ...JSON.stringify(diagram.toJSON(), null, 2).split("\n").map((line) => `// ${line}`),
      'extern "C" void mount() {',
    ];
    for (const block of blocks) {
      const i = index(block.id);
      const config = block.getAllConf();
      const args = [`${i}u`];
      if (!probe) for (const key of Object.keys(config)) {
        if (!block.definition.getConfig(key) && !(key === "channelCount" && block.definition.getInput(key))) {
          throw new Error(`Analyze the diagram before emitting configuration ${block.id}.${key}`);
        }
      }
      if (!probe) for (const prop of block.definition.config.values()) {
        args.push(literal(prop.type.raw, config[prop.id] ?? prop.defaultValue));
      }
      lines.push(`#line 1 "block_${i}"`, `auto* b${i} = new ${block.definition.cppClass}(${args.join(", ")});`,
        `auto i${i} = typename std::remove_pointer_t<decltype(b${i})>::Input{};`);
    }
    for (const block of order) {
      const i = index(block.id);
      for (const port of block.getInputPorts()) {
        if (port.id === "channelCount") {
          const width = Math.max(1, ...connections.filter((c) => c.from.blockId === block.id).map((c) => c.from.vectorIndex + 1));
          const value = probe ? 1 : block.getConf<number>("channelCount") ?? width;
          lines.push(`i${i}.channelCount = ${literal("u8", value)};`);
        }
      }
      for (const connection of connections.filter((c) => c.to.blockId === block.id)) {
        const source = index(connection.from.blockId);
        const ci = connections.indexOf(connection);
        lines.push(`#line 1 "connection_${ci}"`,
          `bld_connect(i${i}.${connection.to.portId}, ${connection.to.vectorIndex}u, bld_port(o${source}.${connection.from.portId}, ${connection.from.vectorIndex}u));`);
      }
      for (const port of block.getInputPorts()) {
        lines.push(`#line 1 "input_${i}_${port.id}"`, `auto port_${i}_input_${port.id} = i${i}.${port.id};`);
      }
      lines.push(`#line 1 "block_${i}"`);
      lines.push(block.getOutputPorts().length ? `auto o${i} = b${i}->apply(move(i${i}));` : `b${i}->apply(move(i${i}));`);
      for (const port of block.getOutputPorts()) lines.push(`#line 1 "output_${i}_${port.id}"`, `auto port_${i}_output_${port.id} = o${i}.${port.id};`);
      if (!probe && block.definition.getInput("pins") && block.definition.getConfig("pins")) {
        lines.push(`register_gpio_block(${i}u, ${literal("u16", block.getConf("port"))}, ${literal("Array<u8>", block.getConf("pins"))});`);
      }
    }
    lines.push("}", "");
    return lines.join("\n");
  }

  async analyze(diagram: Diagram, dumper = ClangAstDumper.defaultDumper()): Promise<DiagramAnalysis> {
    const snapshot = Diagram.fromJSON(structuredClone(diagram.toJSON()), diagram.palette);
    const probe = await dumper.dumpAsync(this.probeFiles(snapshot), "diagram.cpp");
    const analysis = !probe.ok ? this.result(snapshot, probe)
      : this.prepareAnalysis(snapshot, probe)
        ?? this.result(snapshot, await dumper.dumpAsync(this.build(snapshot), "diagram.cpp"));
    analysis.assignTo(diagram);
    return analysis;
  }

  analyzeSync(diagram: Diagram, dumper = ClangAstDumper.defaultDumper()): DiagramAnalysis {
    const probe = dumper.dump(this.probeFiles(diagram), "diagram.cpp");
    const analysis = !probe.ok ? this.result(diagram, probe)
      : this.prepareAnalysis(diagram, probe)
        ?? this.result(diagram, dumper.dump(this.build(diagram), "diagram.cpp"));
    analysis.assignTo(diagram);
    return analysis;
  }

  private prepareAnalysis(diagram: Diagram, probe: ClangDumpResult): DiagramAnalysis | undefined {
    this.readConfigs(diagram, probe.ast as ClangAstJson);
    const inferred = this.result(diagram, probe);
    const diagnostics: DiagramDiagnostic[] = [];
    for (const block of diagram.getBlocks()) {
      for (const [id, value] of Object.entries(block.getAllConf())) {
        const prop = block.definition.getConfig(id);
        try {
          if (!prop && !(id === "channelCount" && block.definition.getInput(id))) throw new Error(`Unknown configuration property "${id}"`);
          literal(prop?.type.raw ?? "u8", value);
          if (id === "channelCount" && (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 255)) throw new Error("Channel count must be an integer between 0 and 255");
        } catch (error) {
          diagnostics.push({ severity: "error", blockId: block.id, configId: id, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    for (const c of diagram.getConnections()) {
      const sourceType = inferred.types.get(c.from.blockId, "output", c.from.portId);
      const targetType = inferred.types.get(c.to.blockId, "input", c.to.portId);
      const source = diagram.getBlock(c.from.blockId)!;
      const target = diagram.getBlock(c.to.blockId)!;
      let message: string | undefined;
      if ((!sourceType?.isVector && c.from.vectorIndex !== 0) || (!targetType?.isVector && c.to.vectorIndex !== 0)) message = "Scalar ports require vector index 0";
      if (source.definition.getInput("channelCount")) {
        const count = source.getConf<number>("channelCount");
        if (c.from.vectorIndex >= (count ?? 255)) message = "Output channel index exceeds the channel count";
      }
      if (c.to.portId === "pins") {
        const pins = target.getConf<unknown[]>("pins");
        if (Array.isArray(pins) && c.to.vectorIndex >= pins.length) message = "Input pin index exceeds the configured pins";
      }
      if (!targetType?.isVector && diagram.getConnections().filter((other) => other.to.equals(c.to)).length > 1) message = "Scalar inputs accept one connection";
      if (message) diagnostics.push({ severity: "error", message, blockId: c.to.blockId, inputId: c.to.portId, outputId: c.from.portId, connectionId: c.id, from: c.from.toJSON(), to: c.to.toJSON() });
    }
    return diagnostics.length ? new DiagramAnalysis(false, inferred.types, diagnostics) : undefined;
  }

  private probeFiles(diagram: Diagram): Map<string, string> {
    const files = new Map(Object.entries(this.libraryFiles));
    files.set("wasm_host.hpp", browserHost);
    files.set("diagram.cpp", this.emitDiagram(diagram, true));
    return files;
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

  private readConfigs(diagram: Diagram, ast: ClangAstJson): void {
    const walk = (node: ClangAstJson, path: string[]) => {
      const ns = node.kind === "NamespaceDecl" && node.name ? [...path, node.name] : path;
      if (node.kind === "ClassTemplateSpecializationDecl" && node.name) {
        const cpp = [...ns, node.name].join("::") + "<>";
        const definitions = diagram.getBlocks().filter((b) => b.definition.cppClass === cpp).map((b) => b.definition);
        const ctor = node.inner?.find((n) => n.kind === "CXXConstructorDecl" && !n.isImplicit && n.inner?.some((p) => p.kind === "ParmVarDecl" && p.name === "blockId"));
        const params = ctor?.inner?.filter((n) => n.kind === "ParmVarDecl").slice(1) ?? [];
        for (const definition of definitions) for (const param of params) {
          if (!param.name) continue;
          const type = ClangQualType.fromAst(param.type).qualType;
          const value = defaultValue(param);
          definition.registerConfig(new ConfigPropertyDefinition(param.name, diagram.typeSystem.parse(type), value));
        }
        return;
      }
      node.inner?.forEach((child) => walk(child, ns));
    };
    walk(ast, []);
  }

  private result(diagram: Diagram, dump: ClangDumpResult): DiagramAnalysis {
    const types = new DiagramPortTypes();
    const unit = dump.ast ? ClangTranslationUnit.parse(dump.ast) : undefined;
    diagram.getBlocks().forEach((block, i) => {
      for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
        const type = unit?.varType(`port_${i}_${port.direction}_${port.id}`);
        if (!type || type.qualType === "auto") continue;
        const endpoints = diagram.getConnections().flatMap((c) => [c.from, c.to]).filter((e) => e.blockId === block.id && e.portType === port.direction && e.portId === port.id);
        const pins = port.id === "pins" ? block.getConf<unknown[]>("pins") : undefined;
        const length = type.isVectorized ? Math.max(pins?.length ?? 1, ...endpoints.map((e) => e.vectorIndex + 1)) : undefined;
        types.set(block.id, port.direction, port.id, new InferredPortType(type, type.isVectorized, length));
      }
    });
    const diagnostics: DiagramDiagnostic[] = [];
    for (const line of dump.diagnostics.split("\n")) {
      const match = line.match(/^(.*?):\d+:\d+: (error|warning|note): (.*)$/);
      if (!match) continue;
      const [, file = "", severity, message = ""] = match;
      const diagnostic: DiagramDiagnostic = { severity: severity as DiagramDiagnostic["severity"], message };
      const connectionMatch = file.match(/^connection_(\d+)$/);
      const blockMatch = file.match(/^(?:block|input|output)_(\d+)(?:_(.*))?$/);
      if (connectionMatch) {
        const c = diagram.getConnections()[Number(connectionMatch[1])];
        if (c) Object.assign(diagnostic, { blockId: c.to.blockId, inputId: c.to.portId, outputId: c.from.portId, connectionId: c.id, from: c.from.toJSON(), to: c.to.toJSON() });
      } else if (blockMatch) {
        diagnostic.blockId = diagram.getBlocks()[Number(blockMatch[1])]?.id;
        if (file.startsWith("input_")) diagnostic.inputId = blockMatch[2];
        if (file.startsWith("output_")) diagnostic.outputId = blockMatch[2];
      }
      diagnostics.push(diagnostic);
    }
    // Template failures point to the helper; their instantiation note carries the connection.
    for (let i = 0; i < diagnostics.length; i++) {
      const error = diagnostics[i]!;
      if (error.severity !== "error" || error.connectionId) continue;
      for (let j = i + 1; j < diagnostics.length && diagnostics[j]!.severity !== "error"; j++) {
        const note = diagnostics[j]!;
        if (note.connectionId) { Object.assign(error, { ...note, severity: error.severity, message: error.message }); break; }
      }
    }
    if (!dump.ok && !diagnostics.some((d) => d.severity === "error")) diagnostics.push({ severity: "error", message: dump.diagnostics || "Clang produced no AST" });
    return new DiagramAnalysis(dump.ok && Boolean(dump.ast), types, diagnostics);
  }
}

function literal(type: string, value: unknown): string {
  if (Array.isArray(value)) return `${type}{${value.map((v) => literal(type.slice(type.indexOf("<") + 1, -1), v)).join(", ")}}`;
  if (value === undefined) return `${type}{}`;
  if (typeof value !== "number" && typeof value !== "boolean") throw new Error(`Invalid C++ config value ${String(value)}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Config values must be finite");
  return CppTypeNames.literalFromClang(type, value);
}

function defaultValue(node: ClangAstJson): unknown {
  const n = node as ClangAstJson & { value?: string | boolean };
  if (n.kind === "IntegerLiteral" || n.kind === "FloatingLiteral") return Number(n.value);
  if (n.kind === "CXXBoolLiteralExpr") return n.value;
  if (n.kind === "InitListExpr") return n.inner?.map(defaultValue);
  if (n.kind === "UnaryOperator" && (n as typeof n & { opcode?: string }).opcode === "-") return -Number(defaultValue(n.inner![0]!));
  for (const child of n.inner ?? []) {
    const value = defaultValue(child);
    if (value !== undefined) return value;
  }
  return undefined;
}
