/**
 * @title Diagram
 */
import {
  ClangAstDumper,
  ClangComment,
  isMainFileNode,
  type ClangAstJson,
} from "cpp";
import { browserHost } from "./browserHost";
import { CppDiagramBuilder, type DiagramAnalysis } from "./cppBuilder";
import { TypeSystem } from "../types";
import { BlockDefinition } from "./blockDefinition";
import { DiagramCompiler, type WasmRuntimeLike, type WasmSessionLike, type CompileOptionsLike } from "./compiler";
import { Connection, type RawConnectionJson } from "./connection";
import { CppBlockCatalog, defaultCppBlockCatalog } from "./cppBlockCatalog";
import { InferredPortType } from "./inferredPortType";
import { DiagramBlock, type RawBlockJson } from "./diagramBlock";
import { PortEndpoint } from "./endpoint";
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
  analyze(dumper?: ClangAstDumper): Promise<DiagramAnalysis>;
  canConnectAsync(from: PortEndpoint, to: PortEndpoint): Promise<{ ok: boolean; reason?: string; diagnostics?: DiagramAnalysis["diagnostics"] }>;
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

  constructor(
    public id: string,
    public title: string,
    readonly palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
    readonly catalog: CppBlockCatalog = defaultCppBlockCatalog,
  ) {}

  get typeSystem(): TypeSystem {
    return this.palette.typeSystem;
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
    return block;
  }

  removeBlock(blockId: string): boolean {
    if (!this.blocks.delete(blockId)) return false;
    for (const [connId, conn] of this.connections) {
      if (conn.connectsBlock(blockId)) this.connections.delete(connId);
    }
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

    if (from.portType !== "output" || to.portType !== "input") return { ok: false, reason: "Connections run from outputs to inputs" };
    if (!Number.isInteger(from.vectorIndex) || !Number.isInteger(to.vectorIndex)) return { ok: false, reason: "Vector index must be an integer" };
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === from.blockId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return this.getConnections().filter((c) => c.from.blockId === id).some((c) => reaches(c.to.blockId, seen));
    };
    if (reaches(to.blockId)) return { ok: false, reason: "Connection creates a cycle" };
    return { ok: true };
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
    const result = new CppDiagramBuilder().analyzeSync(this);
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
    return result.types;
  }

  async analyze(dumper = ClangAstDumper.defaultDumper()): Promise<DiagramAnalysis> {
    const result = await new CppDiagramBuilder().analyze(this, dumper);
    return result;
  }

  async canConnectAsync(from: PortEndpoint, to: PortEndpoint): Promise<{ ok: boolean; reason?: string; diagnostics?: DiagramAnalysis["diagnostics"] }> {
    const check = this.canConnect(from, to);
    if (!check.ok) return check;
    const candidate = Diagram.fromJSON(this.toJSON(), this.palette);
    candidate.connect(from, to);
    const result = await candidate.analyze();
    return { ok: result.ok, diagnostics: result.diagnostics, ...(result.ok ? {} : { reason: result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("\n") }) };
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
    return conn;
  }

  disconnect(connectionId: string): boolean {
    const removed = this.connections.delete(connectionId);
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
    const dumper = ClangAstDumper.defaultDumper();
    const files = new Map<string, string>(Object.entries(ClangAstDumper.libraryFiles));
    files.set("wasm_host.hpp", browserHost);
    files.set("diagram.cpp", source);
    const dump = await dumper.dumpAsync(files, "diagram.cpp");
    if (dump.ast === undefined) {
      throw new Error(`clang++ AST dump of the diagram failed\n${dump.diagnostics}`);
    }
    const mount = findMainFileFunction(dump.ast as ClangAstJson, "mount");
    if (!mount) throw new Error("Diagram source must define mount() and must not start the diagram");
    const meta = readDiagramMeta(dump.ast as ClangAstJson, mount);
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

function findMainFileFunction(ast: ClangAstJson, name: string): ClangAstJson | undefined {
  let found: ClangAstJson | undefined;
  const walk = (node: ClangAstJson): void => {
    if (found) return;
    if (
      (node.kind === "FunctionDecl" || node.kind === "CXXMethodDecl") &&
      node.name === name &&
      isMainFileNode(node, "diagram.cpp")
    ) {
      found = node;
      return;
    }
    for (const child of node.inner ?? []) walk(child);
  };
  walk(ast);
  return found;
}

function readDiagramMeta(ast: ClangAstJson, mount: ClangAstJson): Record<string, unknown> | undefined {
  const direct = ClangComment.of(mount)?.asJson();
  if (direct && isDiagramMeta(direct.value)) return direct.value;
  let found: Record<string, unknown> | undefined;
  const walk = (node: ClangAstJson): void => {
    if (found) return;
    if (node.kind === "FullComment" && isMainFileNode(node, "diagram.cpp")) {
      const parsed = new ClangComment(node).asJson();
      if (parsed && isDiagramMeta(parsed.value)) {
        found = parsed.value;
        return;
      }
    }
    for (const child of node.inner ?? []) walk(child);
  };
  walk(ast);
  return found;
}

function isDiagramMeta(value: Record<string, unknown>): boolean {
  return Boolean(value.blocks && typeof value.blocks === "object" && value.connections && typeof value.connections === "object");
}
