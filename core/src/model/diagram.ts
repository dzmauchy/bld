/**
 * @title Diagram
 */
import { TypeSystem } from "../types";
import { BlockDefinition } from "./blockDefinition";
import {
  ClangTranslationUnit,
  InferredPortType,
  type ClangTypeCatalog,
} from "./clangAst";
import { DiagramCompiler, type WasmRuntimeLike, type WasmSessionLike, type CompileOptionsLike } from "./compiler";
import { Connection, type RawConnectionJson } from "./connection";
import { CppBlockCatalog, CppTypeNames, defaultCppBlockCatalog, type BlockPortTopology } from "./cppBlockCatalog";
import { cppIdent } from "./cppBuilder";
import { DiagramBlock, type RawBlockJson } from "./diagramBlock";
import { PortEndpoint } from "./endpoint";
import { TreeSitterCppSyntax } from "./cppSyntax";
import { Library } from "./library";
import { Palette } from "./palette";

export interface DiagramJson {
  $schema?: string;
  id: string;
  title: string;
  blocks: Record<string, RawBlockJson>;
  connections: Record<string, RawConnectionJson>;
}

export class DiagramPortTypes {
  private readonly ports = new Map<string, InferredPortType>();

  static key(blockId: string, direction: "input" | "output", portId: string): string {
    return `${blockId}\0${direction}\0${portId}`;
  }

  get(blockId: string, direction: "input" | "output", portId: string): InferredPortType | undefined {
    return this.ports.get(DiagramPortTypes.key(blockId, direction, portId));
  }

  require(blockId: string, direction: "input" | "output", portId: string): InferredPortType {
    const inferred = this.get(blockId, direction, portId);
    if (!inferred) throw new Error(`No inferred type for ${blockId}.${direction}.${portId}`);
    return inferred;
  }

  set(blockId: string, direction: "input" | "output", portId: string, inferred: InferredPortType): void {
    this.ports.set(DiagramPortTypes.key(blockId, direction, portId), inferred);
  }

  entries(): { blockId: string; direction: "input" | "output"; portId: string; inferred: InferredPortType }[] {
    const result: { blockId: string; direction: "input" | "output"; portId: string; inferred: InferredPortType }[] = [];
    for (const [key, inferred] of this.ports) {
      const [blockId, direction, portId] = key.split("\0");
      result.push({
        blockId: blockId ?? "",
        direction: direction === "output" ? "output" : "input",
        portId: portId ?? "",
        inferred,
      });
    }
    return result;
  }

  streamType(blockId: string): string | undefined {
    return this.entries().find((entry) => entry.blockId === blockId)?.inferred.qualType;
  }
}

export interface IDiagram {
  id: string;
  title: string;
  readonly palette: Palette;
  readonly typeSystem: TypeSystem;
  inferPortType(blockId: string, portId: string, direction?: "input" | "output"): InferredPortType;
  inferPortTypes(): DiagramPortTypes;
  addBlock(
    refOrDef: string | BlockDefinition,
    position: { x: number; y: number },
    id?: string,
    conf?: Record<string, unknown>,
  ): DiagramBlock;
  removeBlock(blockId: string): boolean;
  getBlock(blockId: string): DiagramBlock | undefined;
  hasBlock(blockId: string): boolean;
  getBlocks(): DiagramBlock[];
  moveBlock(blockId: string, x: number, y: number): void;
  canConnect(from: PortEndpoint, to: PortEndpoint): { ok: boolean; reason?: string };
  connect(from: PortEndpoint, to: PortEndpoint, id?: string): Connection;
  disconnect(connectionId: string): boolean;
  getConnection(connectionId: string): Connection | undefined;
  getConnections(): Connection[];
  getConnectionsForBlock(blockId: string): Connection[];
  toJSON(): DiagramJson;
}

export class Diagram implements IDiagram {
  private readonly blocks = new Map<string, DiagramBlock>();
  private readonly connections = new Map<string, Connection>();
  private readonly nextBlockSeq = new Map<string, number>();
  private inferredPortTypes: DiagramPortTypes | undefined;

  constructor(
    public id: string,
    public title: string,
    readonly palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
    readonly catalog: CppBlockCatalog = defaultCppBlockCatalog,
  ) {}

  get typeSystem(): TypeSystem {
    return this.palette.typeSystem;
  }

  private get clangTypes(): ClangTypeCatalog {
    return this.catalog.clangTypeCatalog;
  }

  // --- Block Operations ---

  addBlock(
    refOrDef: string | BlockDefinition,
    position: { x: number; y: number },
    id?: string,
    conf: Record<string, unknown> = {},
  ): DiagramBlock {
    const def = typeof refOrDef === "string" ? this.palette.getBlock(refOrDef) : refOrDef;
    if (!def) throw new Error(`Unknown block definition "${String(refOrDef)}"`);

    let blockId = id;
    const curSeq = this.nextBlockSeq.get(def.id) ?? 0;
    if (!blockId) {
      blockId = `${def.id}_${curSeq}`;
      this.nextBlockSeq.set(def.id, curSeq + 1);
    } else {
      const match = blockId.match(new RegExp(`^${def.id}_(\\d+)$`));
      if (match) this.nextBlockSeq.set(def.id, Math.max(curSeq, parseInt(match[1], 10) + 1));
    }

    if (this.blocks.has(blockId)) {
      throw new Error(`Diagram already contains a block with id "${blockId}"`);
    }

    const block = new DiagramBlock(blockId, def, position.x, position.y, conf);
    this.blocks.set(blockId, block);
    this.inferredPortTypes = undefined;
    return block;
  }

  removeBlock(blockId: string): boolean {
    if (!this.blocks.delete(blockId)) return false;
    for (const [connId, conn] of this.connections) {
      if (conn.connectsBlock(blockId)) this.connections.delete(connId);
    }
    this.inferredPortTypes = undefined;
    return true;
  }

  getBlock(blockId: string): DiagramBlock | undefined {
    return this.blocks.get(blockId);
  }

  hasBlock(blockId: string): boolean {
    return this.blocks.has(blockId);
  }

  getBlocks(): DiagramBlock[] {
    return this.blocks.values().toArray();
  }

  moveBlock(blockId: string, x: number, y: number): void {
    const block = this.getBlock(blockId);
    if (!block) throw new Error(`Block with id "${blockId}" not found`);
    block.setPosition(x, y);
  }

  // --- Connection Operations ---

  canConnect(from: PortEndpoint, to: PortEndpoint): { ok: boolean; reason?: string } {
    if (from.blockId === to.blockId) return { ok: false, reason: "Cannot connect a block to itself" };
    const fromBlock = this.getBlock(from.blockId);
    if (!fromBlock) return { ok: false, reason: `Source block "${from.blockId}" not found` };
    const toBlock = this.getBlock(to.blockId);
    if (!toBlock) return { ok: false, reason: `Target block "${to.blockId}" not found` };

    const fromPort = from.getPort(fromBlock.definition);
    if (!fromPort) return { ok: false, reason: `Port "${from.portId}" (${from.portType}) not found on block "${from.blockId}"` };
    const toPort = to.getPort(toBlock.definition);
    if (!toPort) return { ok: false, reason: `Port "${to.portId}" (${to.portType}) not found on block "${to.blockId}"` };
    if (from.vectorIndex < 0 || to.vectorIndex < 0) return { ok: false, reason: "Vector index must be non-negative" };

    for (const conn of this.connections.values()) {
      if (conn.matches(from, to)) return { ok: false, reason: "Connection already exists" };
    }

    const dump = this.clangTypes.dumpProbe(this.emitConnectionProbe(from, to));
    if (dump.ok) return { ok: true };
    if (dump.hasTypeError) {
      const first = dump.diagnostics.split("\n").find((line) => /error:/.test(line));
      return { ok: false, reason: first?.replace(/^.*error: /, "") ?? dump.diagnostics };
    }
    throw new Error(`clang++ failed while checking connection\n${dump.diagnostics}`);
  }

  inferPortType(blockId: string, portId: string, direction?: "input" | "output"): InferredPortType {
    const block = this.getBlock(blockId);
    if (!block) throw new Error(`Block with id "${blockId}" not found`);
    const port = block.definition.getPort(portId, direction);
    if (!port) {
      const where = direction ? `${direction} "${portId}"` : `"${portId}"`;
      throw new Error(`Port ${where} not found on block "${blockId}"`);
    }
    return this.inferPortTypes().require(blockId, port.direction, portId);
  }

  inferPortTypes(): DiagramPortTypes {
    if (this.inferredPortTypes) return this.inferredPortTypes;
    const dump = this.clangTypes.dumpProbe(this.emitInferProbe());
    if (!dump.ok || dump.ast === undefined) {
      throw new Error(`clang++ AST dump failed while inferring port types\n${dump.diagnostics}`);
    }
    const unit = ClangTranslationUnit.parse(dump.ast);
    const types = new DiagramPortTypes();
    for (const block of this.getBlocks()) {
      const conf = block.getAllConf();
      for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
        const varName = portVarName(block.id, port.direction, port.id);
        const clangType = unit.varType(varName);
        if (!clangType) throw new Error(`clang AST is missing ${varName}`);
        let vectorLength: number | undefined;
        if (port.lengthBindConfId) {
          const bound = conf[port.lengthBindConfId];
          if (Array.isArray(bound)) vectorLength = bound.length;
        }
        types.set(
          block.id,
          port.direction,
          port.id,
          new InferredPortType(clangType, Boolean(port.vector || clangType.isVectorized), vectorLength),
        );
      }
    }

    for (const connection of this.getConnections()) {
      this.expandVectorLength(types, connection.from.blockId, connection.from.portType, connection.from.portId, connection.from.vectorIndex);
      this.expandVectorLength(types, connection.to.blockId, connection.to.portType, connection.to.portId, connection.to.vectorIndex);
    }
    this.inferredPortTypes = types;
    return types;
  }

  private emitInferProbe(): string {
    const lines = ['#include "base.hpp"', "", "void infer_ports() {"];
    this.getBlocks().forEach((block, index) => {
      const topology = this.catalog.topology(block.ref, block.getAllConf());
      const ident = cppIdent(block.id);
      lines.push(...this.emitProbeConstruct(ident, block, topology, index).map((line) => `  ${line}`));
      lines.push(...this.emitProbePortVars(ident, block, topology).map((line) => `  ${line}`));
    });
    lines.push("}");
    lines.push("");
    return lines.join("\n");
  }

  private emitConnectionProbe(from: PortEndpoint, to: PortEndpoint): string {
    const fromBlock = this.getBlock(from.blockId);
    const toBlock = this.getBlock(to.blockId);
    if (!fromBlock || !toBlock) throw new Error("missing block");
    const fromTop = this.catalog.topology(fromBlock.ref, fromBlock.getAllConf());
    const toTop = this.catalog.topology(toBlock.ref, toBlock.getAllConf());
    const fromIdent = cppIdent(fromBlock.id);
    const toIdent = cppIdent(toBlock.id);
    const lines = ['#include "base.hpp"', "", "void check_connection() {"];
    lines.push(...this.emitProbeConstruct(fromIdent, fromBlock, fromTop, 0).map((line) => `  ${line}`));
    lines.push(...this.emitProbeConstruct(toIdent, toBlock, toTop, 1).map((line) => `  ${line}`));
    lines.push(...this.emitProbeApply(toIdent, toTop, "to_in").map((line) => `  ${line}`));
    const toConsumer = toTop.returnsScalarConsumer() ? "to_in" : `to_in[${to.vectorIndex}]`;
    const stream = fromTop.streamCppType();
    lines.push(`  auto from_dn = ${stream}{};`);
    lines.push(`  from_dn.push_back(${toConsumer});`);
    if (fromTop.registersHostPins()) {
      lines.push(`  ${fromIdent}->connectPin(static_cast<u8>(${from.vectorIndex}), static_cast<${stream}&&>(from_dn));`);
      lines.push(`  ${fromIdent}->apply();`);
    } else if (fromTop.exposesConsumerBank()) {
      lines.push(`  auto from_in = ${fromIdent}->apply(static_cast<u8>(1));`);
      lines.push(`  from_in[${from.vectorIndex}] = ${toConsumer};`);
    } else if (fromTop.returnsIndexedConsumers() && !fromTop.exposesConsumerBank()) {
      lines.push(`  auto from_in = ${fromIdent}->apply(static_cast<${stream}&&>(from_dn), static_cast<u8>(1));`);
    } else if (fromTop.returnsScalarConsumer()) {
      lines.push(`  auto from_in = ${fromIdent}->apply(static_cast<${stream}&&>(from_dn));`);
    } else {
      lines.push(`  ${fromIdent}->apply(static_cast<${stream}&&>(from_dn));`);
    }
    lines.push("}");
    lines.push("");
    return lines.join("\n");
  }

  private emitProbeConstruct(
    ident: string,
    block: DiagramBlock,
    topology: BlockPortTopology,
    numericId: number,
  ): string[] {
    const conf = block.getAllConf();
    const args: string[] = [`${Math.trunc(numericId)}u`];
    const prefix: string[] = [];
    const ctorParams = topology.constructorParameters().slice(1);
    const confProps = [...block.definition.config.values()];
    ctorParams.forEach((param, index) => {
      const prop = confProps[index];
      if (!prop) return;
      if (CppTypeNames.isArrayQualType(param.qualType)) {
        const arr = `${ident}_${prop.id}`;
        const values = arrayValues(conf, prop.id, prop.defaultValue);
        prefix.push(`auto ${arr} = ${param.qualType}{};`);
        for (const value of values) prefix.push(`${arr}.push_back(${value});`);
        args.push(`static_cast<${param.qualType}&&>(${arr})`);
      } else {
        args.push(CppTypeNames.literalFromClang(param.qualType, conf[prop.id] ?? prop.defaultValue ?? 0));
      }
    });
    return [...prefix, `auto* ${ident} = new ${block.definition.cppClass}(${args.join(", ")});`];
  }

  private emitProbePortVars(
    ident: string,
    block: DiagramBlock,
    topology: BlockPortTopology,
  ): string[] {
    const stream = topology.streamCppType();
    const dn = `${ident}_dn`;
    const lines: string[] = [`auto ${dn} = ${stream}{};`];
    const bind = (direction: "input" | "output", portId: string, expr: string) => {
      lines.push(`auto ${portVarName(block.id, direction, portId)} = ${expr};`);
    };

    if (topology.exposesConsumerBank()) {
      lines.push(`auto ${ident}_in = ${ident}->apply(static_cast<u8>(1));`);
      for (const port of block.getOutputPorts()) bind("output", port.id, `${ident}_in`);
      return lines;
    }

    if (topology.registersHostPins()) {
      lines.push(`${ident}->connectPin(static_cast<u8>(0), static_cast<${stream}&&>(${dn}));`);
      lines.push(`${ident}->apply();`);
      for (const port of block.getInputPorts()) bind("input", port.id, dn);
      return lines;
    }

    if (topology.returnsScalarConsumer()) {
      lines.push(`auto ${ident}_in = ${ident}->apply(static_cast<${stream}&&>(${dn}));`);
      for (const port of block.getInputPorts()) bind("input", port.id, `${ident}_in`);
      for (const port of block.getOutputPorts()) bind("output", port.id, `${dn}[0]`);
      return lines;
    }

    if (topology.returnsIndexedConsumers()) {
      lines.push(`auto ${ident}_in = ${ident}->apply(static_cast<${stream}&&>(${dn}), static_cast<u8>(1));`);
      for (const port of block.getInputPorts()) bind("input", port.id, `${ident}_in`);
      for (const port of block.getOutputPorts()) bind("output", port.id, dn);
      return lines;
    }

    lines.push(`${ident}->apply(static_cast<${stream}&&>(${dn}));`);
    for (const port of block.getInputPorts()) bind("input", port.id, dn);
    return lines;
  }

  private emitProbeApply(
    ident: string,
    topology: BlockPortTopology,
    resultIdent: string,
  ): string[] {
    const stream = topology.streamCppType();
    const dn = `${ident}_dn`;
    if (topology.exposesConsumerBank()) {
      return [`auto ${resultIdent} = ${ident}->apply(static_cast<u8>(1));`];
    }
    if (topology.registersHostPins()) {
      return [
        `auto ${dn} = ${stream}{};`,
        `${ident}->connectPin(static_cast<u8>(0), static_cast<${stream}&&>(${dn}));`,
        `${ident}->apply();`,
        `auto ${resultIdent} = ${dn};`,
      ];
    }
    if (topology.returnsScalarConsumer()) {
      return [`auto ${dn} = ${stream}{};`, `auto ${resultIdent} = ${ident}->apply(static_cast<${stream}&&>(${dn}));`];
    }
    if (topology.returnsIndexedConsumers()) {
      return [
        `auto ${dn} = ${stream}{};`,
        `auto ${resultIdent} = ${ident}->apply(static_cast<${stream}&&>(${dn}), static_cast<u8>(1));`,
      ];
    }
    return [`auto ${dn} = ${stream}{};`, `${ident}->apply(static_cast<${stream}&&>(${dn}));`, `auto ${resultIdent} = ${dn};`];
  }

  private expandVectorLength(
    types: DiagramPortTypes,
    blockId: string,
    direction: "input" | "output",
    portId: string,
    vectorIndex: number,
  ): void {
    const current = types.get(blockId, direction, portId);
    if (!current) return;
    types.set(blockId, direction, portId, current.withVectorLength(Math.max(current.vectorLength ?? 0, vectorIndex + 1)));
  }

  connect(from: PortEndpoint, to: PortEndpoint, id?: string): Connection {
    const check = this.canConnect(from, to);
    if (!check.ok) throw new Error(`Cannot connect: ${check.reason}`);

    let connId = id;
    if (!connId) {
      connId = `${from.blockId}__${to.blockId}`;
      let counter = 1;
      while (this.connections.has(connId)) {
        connId = `${from.blockId}__${to.blockId}_${counter++}`;
      }
    }

    const conn = new Connection(connId, from, to);
    this.connections.set(connId, conn);
    this.inferredPortTypes = undefined;
    return conn;
  }

  disconnect(connectionId: string): boolean {
    const removed = this.connections.delete(connectionId);
    if (removed) this.inferredPortTypes = undefined;
    return removed;
  }

  getConnection(connectionId: string): Connection | undefined {
    return this.connections.get(connectionId);
  }

  getConnections(): Connection[] {
    return this.connections.values().toArray();
  }

  getConnectionsForBlock(blockId: string): Connection[] {
    return this.getConnections().filter((c) => c.connectsBlock(blockId));
  }

  // --- Serialization ---

  toJSON(): DiagramJson {
    return {
      id: this.id,
      title: this.title,
      blocks: Object.fromEntries(this.blocks.entries().map(([id, b]) => [id, b.toJSON()])),
      connections: Object.fromEntries(this.connections.entries().map(([id, c]) => [id, c.toJSON()])),
    };
  }

  static async fromCpp(
    source: string,
    palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ): Promise<Diagram> {
    const tree = (await TreeSitterCppSyntax.create()).parse(source);
    if (!tree.hasFunction("mount")) throw new Error("Diagram source must define mount() and must not start the diagram");
    const meta = tree.diagramMeta();
    if (!meta) throw new Error("Diagram source is missing a JSON comment for blocks and connections");
    return Diagram.fromJSON(meta as unknown as DiagramJson, palette);
  }

  static fromJSON(
    json: DiagramJson,
    palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ): Diagram {
    const diagram = new Diagram(json.id, json.title, palette);
    for (const [id, b] of Object.entries(json.blocks ?? {})) diagram.addBlock(b.ref, b, id, b.conf);
    for (const [id, c] of Object.entries(json.connections ?? {})) {
      diagram.connect(PortEndpoint.fromJSON(c.from), PortEndpoint.fromJSON(c.to), id);
    }
    return diagram;
  }

  // --- Compilation & Running ---

  private resolveCompiler(optionsOrCompiler?: CompileOptionsLike | DiagramCompiler, compiler?: DiagramCompiler) {
    return optionsOrCompiler instanceof DiagramCompiler
      ? { compiler: optionsOrCompiler, options: undefined }
      : { compiler: compiler ?? new DiagramCompiler(), options: optionsOrCompiler };
  }

  emitFiles(compiler = new DiagramCompiler()): Map<string, string> {
    return compiler.emitFiles(this);
  }

  emitText(compiler = new DiagramCompiler()): string {
    return compiler.emitText(this);
  }

  compile(options?: CompileOptionsLike, compiler?: DiagramCompiler): Promise<Uint8Array>;
  compile(compiler?: DiagramCompiler): Promise<Uint8Array>;
  compile(optionsOrCompiler?: CompileOptionsLike | DiagramCompiler, compiler?: DiagramCompiler): Promise<Uint8Array> {
    const { compiler: comp, options } = this.resolveCompiler(optionsOrCompiler, compiler);
    return comp.compile(this, options);
  }

  run<TSession extends WasmSessionLike = WasmSessionLike>(
    runtime: WasmRuntimeLike<TSession>,
    options?: CompileOptionsLike,
    compiler?: DiagramCompiler,
  ): Promise<TSession>;
  run<TSession extends WasmSessionLike = WasmSessionLike>(
    runtime: WasmRuntimeLike<TSession>,
    compiler?: DiagramCompiler,
  ): Promise<TSession>;
  run<TSession extends WasmSessionLike = WasmSessionLike>(
    runtime: WasmRuntimeLike<TSession>,
    optionsOrCompiler?: CompileOptionsLike | DiagramCompiler,
    compiler?: DiagramCompiler,
  ): Promise<TSession> {
    const { compiler: comp, options } = this.resolveCompiler(optionsOrCompiler, compiler);
    return comp.run(this, runtime, options);
  }
}

function portVarName(blockId: string, direction: "input" | "output", portId: string): string {
  return `port_${cppIdent(blockId)}_${direction}_${cppIdent(portId)}`;
}

function arrayValues(conf: Record<string, unknown>, key: string, fallback: unknown): number[] {
  const raw = conf[key];
  if (Array.isArray(raw) && raw.length > 0) return raw.map((entry) => Number(entry));
  if (Array.isArray(fallback) && fallback.length > 0) return fallback.map((entry) => Number(entry));
  return [0];
}
