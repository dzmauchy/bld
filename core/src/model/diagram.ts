/**
 * @title Diagram
 */
import { BlockDefinition } from "./blockDefinition";
import { DiagramCompiler, type WasmRuntimeLike, type WasmSessionLike, type CompileOptionsLike } from "./compiler";
import { Connection, type RawConnectionJson } from "./connection";
import { DiagramBlock, type RawBlockJson } from "./diagramBlock";
import { PortEndpoint } from "./endpoint";
import { Palette } from "./palette";
import { Library } from "./library";
import { TypeInference, TypeSystem, type InferredPortType, type DataType } from "../types";
import { diagramSchemaPath } from "../schemaAssets";

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

  streamType(blockId: string): DataType | undefined {
    return this.entries().find((entry) => entry.blockId === blockId && entry.inferred.isStream)?.inferred.dataType;
  }
}

export interface IDiagram {
  id: string;
  title: string;
  readonly palette: Palette;
  readonly typeSystem: TypeSystem;
  readonly typeInference: TypeInference;
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
  public schema = diagramSchemaPath;
  private readonly blocks = new Map<string, DiagramBlock>();
  private readonly connections = new Map<string, Connection>();
  private readonly nextBlockSeq = new Map<string, number>();
  private _typeInference?: TypeInference;

  constructor(
    public id: string,
    public title: string,
    readonly palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ) {}

  get typeSystem(): TypeSystem {
    return this.palette.typeSystem;
  }

  get typeInference(): TypeInference {
    return (this._typeInference ??= new TypeInference(this.typeSystem));
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

    const fromInferred = this.typeInference.inferPort(fromPort, fromBlock.getAllConf());
    const toInferred = this.typeInference.inferPort(toPort, toBlock.getAllConf());
    const inferenceResult = this.typeInference.inferConnection(fromInferred, toInferred);
    if (!inferenceResult.ok) {
      return {
        ok: false,
        reason: inferenceResult.error ?? `Incompatible types: ${fromInferred.dataType.toString()} and ${toInferred.dataType.toString()}`,
      };
    }
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
    const types = new DiagramPortTypes();
    for (const block of this.getBlocks()) {
      const inferred = block.inferPorts(this.typeInference);
      for (const [portId, portType] of inferred.inputs) types.set(block.id, "input", portId, portType);
      for (const [portId, portType] of inferred.outputs) types.set(block.id, "output", portId, portType);
    }

    for (const connection of this.getConnections()) {
      this.expandVectorLength(types, connection.from.blockId, connection.from.portType, connection.from.portId, connection.from.vectorIndex);
      this.expandVectorLength(types, connection.to.blockId, connection.to.portType, connection.to.portId, connection.to.vectorIndex);
    }

    for (const connection of this.getConnections()) {
      const from = types.get(connection.from.blockId, connection.from.portType, connection.from.portId);
      const to = types.get(connection.to.blockId, connection.to.portType, connection.to.portId);
      if (!from || !to) continue;
      const unified = this.typeInference.inferConnection(from, to);
      if (!unified.ok || !unified.effectiveType) continue;
      types.set(
        connection.from.blockId,
        connection.from.portType,
        connection.from.portId,
        from.withType(unified.effectiveType, this.typeInference),
      );
      types.set(
        connection.to.blockId,
        connection.to.portType,
        connection.to.portId,
        to.withType(unified.effectiveType, this.typeInference),
      );
    }

    return types;
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
    return conn;
  }

  disconnect(connectionId: string): boolean {
    return this.connections.delete(connectionId);
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
      $schema: this.schema,
      id: this.id,
      title: this.title,
      blocks: Object.fromEntries(this.blocks.entries().map(([id, b]) => [id, b.toJSON()])),
      connections: Object.fromEntries(this.connections.entries().map(([id, c]) => [id, c.toJSON()])),
    };
  }

  static fromJSON(
    json: DiagramJson,
    palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ): Diagram {
    const diagram = new Diagram(json.id, json.title, palette);
    if (json.$schema) diagram.schema = json.$schema;
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
