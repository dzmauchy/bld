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
import { TypeInference, TypeSystem } from "../types";

export interface DiagramJson {
  $schema?: string;
  id: string;
  title: string;
  blocks: Record<string, RawBlockJson>;
  connections: Record<string, RawConnectionJson>;
}

export class Diagram {
  public schema = "schemas/diagrams.schema.json";
  private blocks = new Map<string, DiagramBlock>();
  private connections = new Map<string, Connection>();
  private nextBlockSeq = new Map<string, number>();

  constructor(
    public id: string,
    public title: string,
    readonly palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ) {}

  private _typeInference?: TypeInference;
  get typeSystem(): TypeSystem {
    return this.palette.typeSystem;
  }

  get typeInference(): TypeInference {
    if (!this._typeInference) {
      this._typeInference = new TypeInference(this.typeSystem);
    }
    return this._typeInference;
  }

  // --- Block Operations ---

  addBlock(
    refOrDef: string | BlockDefinition,
    position: { x: number; y: number },
    id?: string,
    conf: Record<string, unknown> = {},
  ): DiagramBlock {
    const def =
      typeof refOrDef === "string" ? this.palette.getBlock(refOrDef) : refOrDef;
    if (!def) {
      throw new Error(`Unknown block definition "${String(refOrDef)}"`);
    }

    let blockId = id;
    if (!blockId) {
      const seq = this.nextBlockSeq.get(def.id) ?? 0;
      blockId = `${def.id}_${seq}`;
      this.nextBlockSeq.set(def.id, seq + 1);
    } else {
      // Track sequence if matches ${def.id}_N
      const match = blockId.match(new RegExp(`^${def.id}_(\\d+)$`));
      if (match) {
        const num = parseInt(match[1], 10);
        const cur = this.nextBlockSeq.get(def.id) ?? 0;
        if (num >= cur) this.nextBlockSeq.set(def.id, num + 1);
      }
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

    // Cascade remove connections
    for (const [connId, conn] of this.connections) {
      if (conn.connectsBlock(blockId)) {
        this.connections.delete(connId);
      }
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
    return [...this.blocks.values()];
  }

  moveBlock(blockId: string, x: number, y: number): void {
    const block = this.getBlock(blockId);
    if (!block) {
      throw new Error(`Block with id "${blockId}" not found`);
    }
    block.setPosition(x, y);
  }

  // --- Connection Operations ---

  canConnect(from: PortEndpoint, to: PortEndpoint): { ok: boolean; reason?: string } {
    if (from.blockId === to.blockId) {
      return { ok: false, reason: "Cannot connect a block to itself" };
    }

    const fromBlock = this.getBlock(from.blockId);
    if (!fromBlock) {
      return { ok: false, reason: `Source block "${from.blockId}" not found` };
    }

    const toBlock = this.getBlock(to.blockId);
    if (!toBlock) {
      return { ok: false, reason: `Target block "${to.blockId}" not found` };
    }

    const fromPort =
      from.portType === "input"
        ? fromBlock.definition.getInput(from.portId)
        : fromBlock.definition.getOutput(from.portId);
    if (!fromPort) {
      return {
        ok: false,
        reason: `Port "${from.portId}" (${from.portType}) not found on block "${from.blockId}"`,
      };
    }

    const toPort =
      to.portType === "input"
        ? toBlock.definition.getInput(to.portId)
        : toBlock.definition.getOutput(to.portId);
    if (!toPort) {
      return {
        ok: false,
        reason: `Port "${to.portId}" (${to.portType}) not found on block "${to.blockId}"`,
      };
    }

    if (from.vectorIndex < 0 || to.vectorIndex < 0) {
      return { ok: false, reason: "Vector index must be non-negative" };
    }

    // Check duplicate
    for (const conn of this.connections.values()) {
      if (
        (conn.from.equals(from) && conn.to.equals(to)) ||
        (conn.from.equals(to) && conn.to.equals(from))
      ) {
        return { ok: false, reason: "Connection already exists" };
      }
    }

    // Type checking & inference
    const inferenceResult = this.typeInference.inferConnection(fromPort.type, toPort.type);
    if (!inferenceResult.ok) {
      return {
        ok: false,
        reason: inferenceResult.error ?? `Incompatible types: ${fromPort.type.toString()} and ${toPort.type.toString()}`,
      };
    }

    return { ok: true };
  }

  connect(from: PortEndpoint, to: PortEndpoint, id?: string): Connection {
    const check = this.canConnect(from, to);
    if (!check.ok) {
      throw new Error(`Cannot connect: ${check.reason}`);
    }

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
    return [...this.connections.values()];
  }

  getConnectionsForBlock(blockId: string): Connection[] {
    return this.getConnections().filter((c) => c.connectsBlock(blockId));
  }

  // --- Serialization ---

  toJSON(): DiagramJson {
    const blocks: Record<string, RawBlockJson> = {};
    for (const [id, block] of this.blocks) {
      blocks[id] = block.toJSON();
    }

    const connections: Record<string, RawConnectionJson> = {};
    for (const [id, conn] of this.connections) {
      connections[id] = conn.toJSON();
    }

    return {
      $schema: this.schema,
      id: this.id,
      title: this.title,
      blocks,
      connections,
    };
  }

  static fromJSON(
    json: DiagramJson,
    palette: Palette = Library.getBaseSync()?.palette ?? new Palette(new TypeSystem()),
  ): Diagram {
    const diagram = new Diagram(json.id, json.title, palette);
    if (json.$schema) diagram.schema = json.$schema;

    for (const [blockId, blockData] of Object.entries(json.blocks ?? {})) {
      diagram.addBlock(
        blockData.ref,
        { x: blockData.x, y: blockData.y },
        blockId,
        blockData.conf ?? {},
      );
    }

    for (const [connId, connData] of Object.entries(json.connections ?? {})) {
      const from = PortEndpoint.fromJSON(connData.from);
      const to = PortEndpoint.fromJSON(connData.to);
      diagram.connect(from, to, connId);
    }

    return diagram;
  }

  // --- Compilation & Running ---

  emitText(compiler = new DiagramCompiler()): string {
    return compiler.emitText(this);
  }

  compile(options?: CompileOptionsLike, compiler?: DiagramCompiler): Uint8Array;
  compile(compiler?: DiagramCompiler): Uint8Array;
  compile(
    optionsOrCompiler?: CompileOptionsLike | DiagramCompiler,
    compiler?: DiagramCompiler,
  ): Uint8Array {
    if (optionsOrCompiler instanceof DiagramCompiler) {
      return optionsOrCompiler.compile(this);
    }
    const effectiveCompiler = compiler ?? new DiagramCompiler();
    return effectiveCompiler.compile(this, optionsOrCompiler);
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
    if (optionsOrCompiler instanceof DiagramCompiler) {
      return optionsOrCompiler.run(this, runtime);
    }
    const effectiveCompiler = compiler ?? new DiagramCompiler();
    return effectiveCompiler.run(this, runtime, optionsOrCompiler);
  }
}
