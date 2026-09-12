/**
 * @title Diagram Compiler
 */
import type { Connection } from "./connection";
import type { Diagram } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";

export interface AsSessionLike {
  tick(): Promise<number>;
  tickThenObserve(): Promise<number>;
  setNow(ms: number): Promise<number>;
  setRandom(value: number): Promise<number>;
  emitGpioIn(blockId: number, pinIndex: number, value: boolean): Promise<number>;
  close(): Promise<number>;
  clearPins(): Promise<number>;
  lastPin(blockId: number, pin: number): Promise<number>;
  hasPin(blockId: number, pin: number): Promise<boolean>;
  pinWriteCount(): Promise<number>;
  activeIntervalCount(): Promise<number>;
  intervalPeriodAt(index: number): Promise<number>;
  activeGpioListenerCount(): Promise<number>;
  call(name: string, ...args: number[]): Promise<number>;
}

export interface CompileOptionsLike {
  debug?: boolean;
  optimizeLevel?: number;
}

export interface AsRuntimeLike {
  compileSource(source: string): Promise<Uint8Array>;
  instantiate(wasm: Uint8Array): Promise<AsSessionLike>;
  createSession(source: string): Promise<AsSessionLike>;
}

const GENERATED_PRELUDE = `import { DiscardF32, TestExecutionContext, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./harness";
import { Block } from "./context";
import { const_f32, cos_f32, cos_gen_f32, gpio_in, product_f32, pulse_gen_f32, rand_gen_f32, scope_f32, sin_f32, sin_gen_f32 } from "./blocks";

const ec = new TestExecutionContext();
`;

const GENERATED_EXPORTS = `
export function tick(): void { ec.tick(); }
export function setNow(ms: u32): void { ec.setNow(u64(ms)); }
export function setRandom(value: f32): void { ec.setRandom(value); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
export function close(): void { ec.close(); }
export function clearPins(): void { ec.clearPins(); }
export function lastPin(blockId: u32, pin: u8): f32 { return ec.lastPin(blockId, pin); }
export function hasPin(blockId: u32, pin: u8): i32 { return ec.hasPin(blockId, pin) ? 1 : 0; }
export function pinWriteCount(): i32 { return ec.pinWriteCount(); }
export function activeIntervalCount(): i32 { return ec.activeIntervalCount(); }
export function intervalPeriodAt(index: i32): u32 { return ec.intervalPeriodAt(index); }
export function activeGpioListenerCount(): i32 { return ec.activeGpioListenerCount(); }
export function tickThenObserve(): void { ec.tickThenObserve(); }
`;

function wrapDest(streams: string[]): string {
  if (streams.length === 0) return "dest1(new DiscardF32())";
  if (streams.length === 1) return `dest1(${streams[0]})`;
  if (streams.length === 2) return `dest2(${streams[0]}, ${streams[1]})`;
  if (streams.length === 3) return `dest3(${streams[0]}, ${streams[1]}, ${streams[2]})`;
  return `[${streams.join(", ")}]`;
}

export class DiagramCompiler {
  generateAssemblyScript(diagram: Diagram): string {
    const blocks = diagram.getBlocks();
    const connections = diagram.getConnections();

    const blockIdMap = new Map<string, number>();
    blocks.forEach((b, i) => blockIdMap.set(b.id, i));

    const sinks = blocks.filter((b) => b.definition.category === "sinks");
    const transformers = blocks.filter((b) => b.definition.category === "transformers");
    const sources = blocks.filter(
      (b) => b.definition.category === "sources" || (!sinks.includes(b) && !transformers.includes(b)),
    );

    const lines: string[] = [];
    // Map from "blockId.portId.vectorIndex" -> stream variable name (e.g. "scope_0_sinks[0]")
    const outputStreamMap = new Map<string, string>();

    // 1. Generate Sinks
    for (const block of sinks) {
      const numId = blockIdMap.get(block.id) ?? 0;
      const varName = block.id.replace(/[^a-zA-Z0-9_]/g, "_");

      // Find max connected vector index for this sink
      const blockConns = connections.filter((c) => c.connectsBlock(block.id));
      let maxVec = 0;
      for (const c of blockConns) {
        const ep = c.from.blockId === block.id ? c.from : c.to;
        if (ep.vectorIndex > maxVec) maxVec = ep.vectorIndex;
      }
      const outputCount = maxVec + 1;
      const period = Number(block.getConf("period") ?? 60);
      const precision = Number(block.getConf("precision") ?? 10);

      lines.push(`const ${varName} = new scope_f32(${numId}, widths(${outputCount}), ec, ${period}, ${precision});`);
      lines.push(`const ${varName}_sinks = ${varName}.apply();`);

      for (let i = 0; i < outputCount; i++) {
        outputStreamMap.set(`${block.id}.sink.${i}`, `${varName}_sinks[${i}]`);
      }
    }

    // Helper to find downstream stream for a block
    const getDownstreamStreams = (block: DiagramBlock): string[] => {
      const downstreams: string[] = [];
      for (const c of connections) {
        let targetBlockId = "";
        let targetPortId = "";
        let targetVec = 0;

        if (c.from.blockId === block.id) {
          targetBlockId = c.to.blockId;
          targetPortId = c.to.portId;
          targetVec = c.to.vectorIndex;
        } else if (c.to.blockId === block.id) {
          targetBlockId = c.from.blockId;
          targetPortId = c.from.portId;
          targetVec = c.from.vectorIndex;
        } else {
          continue;
        }

        const streamVar = outputStreamMap.get(`${targetBlockId}.${targetPortId}.${targetVec}`);
        if (streamVar) downstreams.push(streamVar);
      }
      return downstreams;
    };

    // 2. Generate Transformers (in order)
    for (const block of transformers) {
      const numId = blockIdMap.get(block.id) ?? 0;
      const varName = block.id.replace(/[^a-zA-Z0-9_]/g, "_");
      const downstreams = getDownstreamStreams(block);
      const destArg = wrapDest(downstreams);

      if (block.ref === "product_f32") {
        // Count factors
        const blockConns = connections.filter((c) => c.connectsBlock(block.id));
        let maxVec = 1;
        for (const c of blockConns) {
          const ep = c.from.blockId === block.id ? c.from : c.to;
          if (ep.portId === "v" && ep.vectorIndex > maxVec) maxVec = ep.vectorIndex;
        }
        const factorCount = maxVec + 1;
        lines.push(`const ${varName} = new product_f32(${numId}, widths(${factorCount}), ec);`);
        lines.push(`const ${varName}_factors = ${varName}.apply(${destArg});`);
        for (let i = 0; i < factorCount; i++) {
          outputStreamMap.set(`${block.id}.v.${i}`, `${varName}_factors[${i}]`);
        }
      } else if (block.ref === "cos_f32") {
        lines.push(`const ${varName} = new cos_f32(${numId}, widths(1), ec);`);
        lines.push(`const ${varName}_in = ${varName}.apply(${destArg});`);
        outputStreamMap.set(`${block.id}.v.0`, `${varName}_in`);
      } else if (block.ref === "sin_f32") {
        lines.push(`const ${varName} = new sin_f32(${numId}, widths(1), ec);`);
        lines.push(`const ${varName}_in = ${varName}.apply(${destArg});`);
        outputStreamMap.set(`${block.id}.v.0`, `${varName}_in`);
      }
    }

    // 3. Generate Sources
    for (const block of sources) {
      const numId = blockIdMap.get(block.id) ?? 0;
      const varName = block.id.replace(/[^a-zA-Z0-9_]/g, "_");
      const precision = Number(block.getConf("precision") ?? 10);
      const downstreams = getDownstreamStreams(block);
      const destArg = wrapDest(downstreams);

      if (block.ref === "cos_gen_f32") {
        lines.push(`new cos_gen_f32(${numId}, widths(1), ec, ${precision}).apply(${destArg});`);
      } else if (block.ref === "sin_gen_f32") {
        lines.push(`new sin_gen_f32(${numId}, widths(1), ec, ${precision}).apply(${destArg});`);
      } else if (block.ref === "rand_gen_f32") {
        lines.push(`new rand_gen_f32(${numId}, widths(1), ec, ${precision}).apply(${destArg});`);
      } else if (block.ref === "pulse_gen_f32") {
        const period = Number(block.getConf("period") ?? 10);
        const dutyCycle = Number(block.getConf("duty_cycle") ?? 0.5);
        lines.push(`new pulse_gen_f32(${numId}, widths(1), ec, ${period}, ${dutyCycle}).apply(${destArg});`);
      } else if (block.ref === "const_f32") {
        const v = Number(block.getConf("v") ?? 0.0);
        const vStr = Number.isInteger(v) ? `${v}.0` : String(v);
        lines.push(`new const_f32(${numId}, widths(1), ec, ${precision}, ${vStr}).apply(${destArg});`);
      } else if (block.ref === "gpio_in") {
        const rawPins = block.getConf<number[]>("pins") ?? [0];
        const pinsList = Array.isArray(rawPins) ? rawPins : [0];
        lines.push(
          `const ${varName} = new gpio_in(${numId}, widths(1), ec, pins(${pinsList.join(", ")}));`,
        );
        lines.push(`${varName}.apply(gpioSinks(${destArg}));`);
      }
    }

    const body = lines.join("\n");
    return `${GENERATED_PRELUDE}\n${body}\n${GENERATED_EXPORTS}\n`;
  }

  async compile(
    diagram: Diagram,
    runtime: AsRuntimeLike,
    options?: CompileOptionsLike,
  ): Promise<Uint8Array> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.compileSource(source);
  }

  async run(diagram: Diagram, runtime: AsRuntimeLike): Promise<AsSessionLike> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.createSession(source);
  }
}
