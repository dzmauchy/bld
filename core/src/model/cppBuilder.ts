/** Generates one C++ program for both type analysis and compilation. */
import { ClangAstDumper, ClangTranslationUnit, CppTypeNames, type ClangAstJson, type ClangDumpResult, type ICppCompiler } from "cpp";
import { Diagram, DiagramPortTypes } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";
import type { Connection } from "./connection";
import type { PortEndpoint } from "./endpoint";
import { ConfigPropertyDefinition } from "./blockDefinition";
import { ClangFunctionCatalog, type FunctionParameter } from "./clangFunctionCatalog";
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
template <typename Port>
auto bld_take(Port port, unsigned count) {
  if constexpr (requires { port(static_cast<u8>(count)); }) return port(static_cast<u8>(count));
  else return port;
}
template <typename Taken>
auto bld_at(Taken taken, unsigned index) {
  if constexpr (requires { taken.size(); taken[index]; }) return taken[index];
  else return taken;
}
template <typename Callable> struct BldCallable;
template <typename Result, typename Input>
struct BldCallable<core::function<Result(Input)>> { using InputType = Input; };

// Pointer lists live through the wiring call; blocks copy them into their state.
template <typename Port, unsigned Count, unsigned Width = 0> class BldInput {
 public:
  void connect(unsigned, Port value) { value_ = value; }
  Port view() { return value_; }
 private:
  Port value_{};
};
template <typename T, unsigned Count, unsigned Width> class BldInput<core::span<T* const>, Count, Width> {
 public:
  void connect(unsigned, T* value) { values_[size_++] = value; }
  core::span<T* const> view() { return {values_, size_}; }
 private:
  T* values_[Count ? Count : 1]{};
  unsigned size_ = 0;
};
template <typename Port, unsigned Count, unsigned Width> class BldInput<core::array<Port>, Count, Width> {
 public:
  template <typename Value> void connect(unsigned index, Value value) {
    groups_[index].connect(0, value);
  }
  core::array<Port> view() {
    core::array<Port> ports(Width);
    for (unsigned i = 0; i < Width; ++i) ports[i] = groups_[i].view();
    return ports;
  }
 private:
  BldInput<Port, Count> groups_[Width ? Width : 1];
};
template <typename Input, typename Value>
void bld_connect(Input& input, unsigned index, Value value) {
  if constexpr (requires { input.view(); }) input.connect(index, value);
}
template <unsigned Count = 0, unsigned Width = 0, typename Port>
auto bld_input(const Port&) { return BldInput<Port, Count, Width>{}; }
template <unsigned Count, unsigned Width, typename Port, typename Taken>
auto bld_input(const Port&, Taken taken, unsigned sourceIndex) {
  if constexpr (requires { Port{taken.data() + sourceIndex, 1}; }) {
    return Port{taken.data() + sourceIndex, 1};
  } else if constexpr (requires(Port port) { port = taken; }) {
    return taken;
  } else {
    return BldInput<Port, Count, Width>{};
  }
}
template <typename Input>
auto bld_view(Input& input) {
  if constexpr (requires { input.view(); }) return input.view();
  else return input;
}
template <typename T, typename... Values>
core::array<T> bld_array(Values... values) {
  if constexpr (sizeof...(Values) == 0) return {};
  else {
    const T elements[]{static_cast<T>(values)...};
    return core::array<T>{elements};
  }
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
    const headers = Object.keys(this.libraryFiles).filter((name) => /\.(h|hpp|hh|hxx)$/.test(name)).sort();
    const lines = [
      // The pinned clang-wasm loop vectorizer stalls on the GPIO factory.
      // Load its dependencies first so only GPIO declarations get optnone.
      ...(headers.includes("base/gpio_in.hpp") ? [
        '#include <core/hal.hpp>', '#pragma clang optimize off',
        '#include <base/gpio_in.hpp>', '#pragma clang optimize on',
      ] : []),
      ...headers.map((name) => `#include <${name}>`),
      '#include "wasm_host.hpp"', helpers,
      ...JSON.stringify(diagram.toJSON(), null, 2).split("\n").map((line) => `// ${line}`),
      'extern "C" void mount() {',
    ];
    for (const block of order) {
      const i = index(block.id);
      const config = block.getAllConf();
      if (!probe) for (const key of Object.keys(config)) {
        if (!block.definition.getConfig(key)) {
          throw new Error(`Analyze the diagram before emitting configuration ${block.id}.${key}`);
        }
      }
      const args = [`${i}u`];
      if (!probe) for (const prop of block.definition.config.values()) {
        args.push(literal(prop.type.raw, config[prop.id] ?? prop.defaultValue));
      }
      const hasInput = block.definition.inputs.size > 0;
      const hasOutput = block.definition.outputs.size > 0;
      lines.push(`#line 1 "block_${i}"`, `static auto b${i} = ${block.definition.cppFactory}(${args.join(", ")});`);
      if (hasInput) {
        lines.push(`auto i${i} = typename BldCallable<decltype(b${i})>::InputType{};`);
        for (const port of block.getInputPorts()) {
          const incoming = connections.filter((c) => c.to.blockId === block.id && c.to.portId === port.id);
          const input = `input_${i}_${port.id}`;
          const width = Math.max(0, ...incoming.map((c) => c.to.vectorIndex + 1));
          const makeInput = `bld_input<${incoming.length}, ${width}>`;
          if (incoming.length === 1) {
            const connection = incoming[0]!;
            const source = index(connection.from.blockId);
            lines.push(`#line 1 "connection_${connections.indexOf(connection)}"`,
              `auto ${input} = ${makeInput}(i${i}.${port.id}, taken_${source}_${connection.from.portId}, ${connection.from.vectorIndex}u);`,
              `bld_connect(${input}, ${connection.to.vectorIndex}u, bld_at(taken_${source}_${connection.from.portId}, ${connection.from.vectorIndex}u));`);
          } else {
            lines.push(`#line 1 "input_${i}_${port.id}"`, `auto ${input} = ${makeInput}(i${i}.${port.id});`);
            for (const connection of incoming) {
              const source = index(connection.from.blockId);
              lines.push(`#line 1 "connection_${connections.indexOf(connection)}"`,
                `bld_connect(${input}, ${connection.to.vectorIndex}u, bld_at(taken_${source}_${connection.from.portId}, ${connection.from.vectorIndex}u));`);
            }
          }
          lines.push(`#line 1 "input_${i}_${port.id}"`, `i${i}.${port.id} = bld_view(${input});`, `auto port_${i}_input_${port.id} = i${i}.${port.id};`);
        }
      }
      lines.push(`#line 1 "block_${i}"`);
      if (hasOutput && hasInput) lines.push(`auto o${i} = b${i}(core::detail::move(i${i}));`);
      else if (hasOutput) lines.push(`auto o${i} = b${i}();`);
      else if (hasInput) lines.push(`b${i}(core::detail::move(i${i}));`);
      else lines.push(`b${i}();`);
      for (const port of block.getOutputPorts()) {
        const width = Math.max(1, ...connections.filter((c) => c.from.blockId === block.id && c.from.portId === port.id).map((c) => c.from.vectorIndex + 1));
        lines.push(`#line 1 "output_${i}_${port.id}"`, `auto port_${i}_output_${port.id} = o${i}.${port.id};`,
          `auto taken_${i}_${port.id} = bld_take(port_${i}_output_${port.id}, ${width}u);`);
      }
      if (!probe && block.definition.getInput("pins") && block.definition.getConfig("pins")) {
        const pins = block.definition.getConfig("pins")!;
        lines.push(`register_gpio_block(${i}u, ${literal(block.definition.getConfig("port")?.type.raw ?? "u16", block.getConf("port"))}, ${literal(pins.type.raw, block.getConf("pins"))});`);
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
          if (!prop) throw new Error(`Unknown configuration property "${id}"`);
          literal(prop.type.raw, value);
        } catch (error) {
          diagnostics.push({ severity: "error", blockId: block.id, configId: id, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    for (const c of diagram.getConnections()) {
      const sourceType = inferred.types.get(c.from.blockId, "output", c.from.portId);
      const targetType = inferred.types.get(c.to.blockId, "input", c.to.portId);
      const target = diagram.getBlock(c.to.blockId)!;
      let message: string | undefined;
      if ((!sourceType?.isVector && c.from.vectorIndex !== 0) || (!targetType?.isVector && c.to.vectorIndex !== 0)) message = "Scalar ports require vector index 0";
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

  private resolvedParameters(
    catalog: ClangFunctionCatalog,
    definition: DiagramBlock["definition"],
    variable: string,
  ): readonly FunctionParameter[] | undefined {
    const declared = catalog.parametersFor(definition.cppFactory);
    if (declared) return declared;
    const called = catalog.calledParameters(variable);
    if (!called) return undefined;
    const names = [...definition.config.keys()];
    if (called.length !== names.length) return undefined;
    return called.map((param, index) => ({ ...param, name: names[index]! }));
  }

  private readConfigs(diagram: Diagram, ast: ClangAstJson): void {
    const catalog = ClangFunctionCatalog.fromAst(ast);
    const seen = new Set<DiagramBlock["definition"]>();
    for (const block of diagram.getBlocks()) {
      const definition = block.definition;
      if (seen.has(definition)) continue;
      seen.add(definition);
      const resolved = this.resolvedParameters(catalog, definition, `b${diagram.getBlocks().indexOf(block)}`);
      if (!resolved) continue;
      const properties = resolved.map((param) => {
        const existing = definition.getConfig(param.name);
        return new ConfigPropertyDefinition(
          param.name,
          diagram.typeSystem.parse(param.type),
          param.defaultValue,
          existing?.control ?? {},
          existing?.title ?? param.name,
          existing?.description ?? "",
          existing?.icon ?? "",
        );
      });
      definition.assignParameters(properties);
    }
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
  if (Array.isArray(value)) {
    if (!/\barray\s*</.test(type)) {
      if (value.length === 1) return literal(type, value[0]);
      throw new Error(`Invalid C++ config value ${JSON.stringify(value)}`);
    }
    const inner = type.slice(type.indexOf("<") + 1, type.lastIndexOf(">"));
    return `bld_array<${inner}>(${value.map((v) => literal(inner, v)).join(", ")})`;
  }
  if (value === undefined) return `${type}{}`;
  if (typeof value !== "number" && typeof value !== "boolean") throw new Error(`Invalid C++ config value ${String(value)}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Config values must be finite");
  return CppTypeNames.literalFromClang(type, value);
}
