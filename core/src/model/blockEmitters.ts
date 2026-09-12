/**
 * @title Block Emitters
 */
import type { Connection } from "./connection";
import type { DiagramBlock } from "./diagramBlock";

export class CodegenSession {
  readonly lines: string[] = [];
  readonly outputStreamMap = new Map<string, string>();
  private readonly blockIdMap = new Map<string, number>();

  constructor(
    readonly blocks: readonly DiagramBlock[],
    readonly connections: readonly Connection[],
  ) {
    blocks.forEach((block, index) => this.blockIdMap.set(block.id, index));
  }

  numericId(block: DiagramBlock): number {
    return this.blockIdMap.get(block.id) ?? 0;
  }

  varName(block: DiagramBlock): string {
    return block.id.replace(/[^a-zA-Z0-9_]/g, "_");
  }

  wrapDest(streams: string[]): string {
    if (streams.length === 0) return "dest1(new DiscardF32())";
    if (streams.length === 1) return `dest1(${streams[0]})`;
    if (streams.length === 2) return `dest2(${streams[0]}, ${streams[1]})`;
    if (streams.length === 3) return `dest3(${streams[0]}, ${streams[1]}, ${streams[2]})`;
    return `[${streams.join(", ")}]`;
  }

  getDownstreamStreams(block: DiagramBlock): string[] {
    const downstreams: string[] = [];
    for (const connection of this.connections) {
      let targetBlockId = "";
      let targetPortId = "";
      let targetVec = 0;

      if (connection.from.blockId === block.id) {
        targetBlockId = connection.to.blockId;
        targetPortId = connection.to.portId;
        targetVec = connection.to.vectorIndex;
      } else if (connection.to.blockId === block.id) {
        targetBlockId = connection.from.blockId;
        targetPortId = connection.from.portId;
        targetVec = connection.from.vectorIndex;
      } else {
        continue;
      }

      const streamVar = this.outputStreamMap.get(`${targetBlockId}.${targetPortId}.${targetVec}`);
      if (streamVar) downstreams.push(streamVar);
    }
    return downstreams;
  }

  maxVectorIndex(block: DiagramBlock, portId?: string, fallback = 0): number {
    let maxVec = fallback;
    for (const connection of this.connections) {
      if (!connection.connectsBlock(block.id)) continue;
      const endpoint = connection.from.blockId === block.id ? connection.from : connection.to;
      if (portId !== undefined && endpoint.portId !== portId) continue;
      if (endpoint.vectorIndex > maxVec) maxVec = endpoint.vectorIndex;
    }
    return maxVec;
  }
}

export abstract class BlockEmitter {
  abstract emit(block: DiagramBlock, session: CodegenSession): void;
}

export class BlockEmitterRegistry {
  private readonly emitters = new Map<string, BlockEmitter>();

  register(ref: string, emitter: BlockEmitter): this {
    this.emitters.set(ref, emitter);
    return this;
  }

  has(ref: string): boolean {
    return this.emitters.has(ref);
  }

  emit(block: DiagramBlock, session: CodegenSession): void {
    this.emitters.get(block.ref)?.emit(block, session);
  }
}

class ScopeEmitter extends BlockEmitter {
  emit(block: DiagramBlock, session: CodegenSession): void {
    const varName = session.varName(block);
    const outputCount = session.maxVectorIndex(block) + 1;
    const period = Number(block.getConf("period") ?? 60);
    const precision = Number(block.getConf("precision") ?? 10);
    session.lines.push(
      `const ${varName} = new scope_f32(${session.numericId(block)}, widths(${outputCount}), ec, ${period}, ${precision});`,
    );
    session.lines.push(`const ${varName}_sinks = ${varName}.apply();`);
    for (let i = 0; i < outputCount; i++) {
      session.outputStreamMap.set(`${block.id}.sink.${i}`, `${varName}_sinks[${i}]`);
    }
  }
}

class ProductEmitter extends BlockEmitter {
  emit(block: DiagramBlock, session: CodegenSession): void {
    const varName = session.varName(block);
    const destArg = session.wrapDest(session.getDownstreamStreams(block));
    const factorCount = session.maxVectorIndex(block, "v", 1) + 1;
    session.lines.push(
      `const ${varName} = new product_f32(${session.numericId(block)}, widths(${factorCount}), ec);`,
    );
    session.lines.push(`const ${varName}_factors = ${varName}.apply(${destArg});`);
    for (let i = 0; i < factorCount; i++) {
      session.outputStreamMap.set(`${block.id}.v.${i}`, `${varName}_factors[${i}]`);
    }
  }
}

class UnaryTransformerEmitter extends BlockEmitter {
  constructor(private readonly ctorName: string) {
    super();
  }

  emit(block: DiagramBlock, session: CodegenSession): void {
    const varName = session.varName(block);
    const destArg = session.wrapDest(session.getDownstreamStreams(block));
    session.lines.push(
      `const ${varName} = new ${this.ctorName}(${session.numericId(block)}, widths(1), ec);`,
    );
    session.lines.push(`const ${varName}_in = ${varName}.apply(${destArg});`);
    session.outputStreamMap.set(`${block.id}.v.0`, `${varName}_in`);
  }
}

class GeneratorEmitter extends BlockEmitter {
  constructor(
    private readonly ctorName: string,
    private readonly extraArgs: (block: DiagramBlock) => string[] = (block) => [
      String(Number(block.getConf("precision") ?? 10)),
    ],
  ) {
    super();
  }

  emit(block: DiagramBlock, session: CodegenSession): void {
    const destArg = session.wrapDest(session.getDownstreamStreams(block));
    const args = [`${session.numericId(block)}`, "widths(1)", "ec", ...this.extraArgs(block)].join(", ");
    session.lines.push(`new ${this.ctorName}(${args}).apply(${destArg});`);
  }
}

class GpioInEmitter extends BlockEmitter {
  emit(block: DiagramBlock, session: CodegenSession): void {
    const varName = session.varName(block);
    const destArg = session.wrapDest(session.getDownstreamStreams(block));
    const rawPins = block.getConf<number[]>("pins") ?? [0];
    const pinsList = Array.isArray(rawPins) ? rawPins : [0];
    session.lines.push(
      `const ${varName} = new gpio_in(${session.numericId(block)}, widths(1), ec, pins(${pinsList.join(", ")}));`,
    );
    session.lines.push(`${varName}.apply(gpioSinks(${destArg}));`);
  }
}

export const defaultBlockEmitters = new BlockEmitterRegistry()
  .register("scope_f32", new ScopeEmitter())
  .register("product_f32", new ProductEmitter())
  .register("cos_f32", new UnaryTransformerEmitter("cos_f32"))
  .register("sin_f32", new UnaryTransformerEmitter("sin_f32"))
  .register("cos_gen_f32", new GeneratorEmitter("cos_gen_f32"))
  .register("sin_gen_f32", new GeneratorEmitter("sin_gen_f32"))
  .register("rand_gen_f32", new GeneratorEmitter("rand_gen_f32"))
  .register("pulse_gen_f32", new GeneratorEmitter("pulse_gen_f32", (block) => [
    String(Number(block.getConf("period") ?? 10)),
    String(Number(block.getConf("duty_cycle") ?? 0.5)),
  ]))
  .register(
    "const_f32",
    new GeneratorEmitter("const_f32", (block) => {
      const precision = Number(block.getConf("precision") ?? 10);
      const value = Number(block.getConf("v") ?? 0.0);
      const valueStr = Number.isInteger(value) ? `${value}.0` : String(value);
      return [String(precision), valueStr];
    }),
  )
  .register("gpio_in", new GpioInEmitter());
