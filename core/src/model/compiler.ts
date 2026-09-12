/**
 * @title Diagram Compiler
 */
import type { Connection } from "./connection";
import type { Diagram } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";

export interface ASSessionLike {
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

export interface ASRuntimeLike<TSession extends ASSessionLike = ASSessionLike> {
  compileSource(
    source: string,
    files?: Record<string, string>,
    options?: CompileOptionsLike,
  ): Promise<Uint8Array>;
  instantiate(wasm: Uint8Array): Promise<TSession>;
  createSession(
    source: string,
    files?: Record<string, string>,
    options?: CompileOptionsLike,
  ): Promise<TSession>;
}

export interface CompilerContext {
  readonly name: string;
  getFiles?(): Record<string, string>;
  getPrelude(): string;
  getExports(): string;
}

const COMMON_PRELUDE_IMPORTS = `import { Block, DiscardF32, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./context";
import { const_f32, cos_f32, cos_gen_f32, gpio_in, product_f32, pulse_gen_f32, rand_gen_f32, scope_f32, sin_f32, sin_gen_f32 } from "./blocks";`;

const BROWSER_CONTEXT_SOURCE = `import { CloseHandler, ExecutionContext, GpioInHandler, IntervalHandler } from "./context";

@external("env", "sendPinF32")
declare function hostSendPinF32(blockId: u32, pin: u8, value: f32): void;

class IntervalEntry {
  id: u32;
  period: u32;
  handler: IntervalHandler;
  active: bool;

  constructor(id: u32, period: u32, handler: IntervalHandler) {
    this.id = id;
    this.period = period;
    this.handler = handler;
    this.active = true;
  }
}

class GpioListener {
  blockId: u32;
  handler: GpioInHandler;
  active: bool;

  constructor(blockId: u32, handler: GpioInHandler) {
    this.blockId = blockId;
    this.handler = handler;
    this.active = true;
  }
}

export class BrowserExecutionContext extends ExecutionContext {
  private nextIntervalId: u32 = 1;
  private intervals: Array<IntervalEntry> = new Array<IntervalEntry>();
  private closeHandlers: Array<CloseHandler> = new Array<CloseHandler>();
  private gpioListeners: Array<GpioListener> = new Array<GpioListener>();

  setInterval(period: u32, handler: IntervalHandler): u32 {
    const id = this.nextIntervalId++;
    this.intervals.push(new IntervalEntry(id, period, handler));
    return id;
  }

  clearInterval(id: u32): void {
    for (let i = 0; i < this.intervals.length; i++) {
      if (this.intervals[i].id == id) {
        this.intervals[i].active = false;
      }
    }
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  sendPinF32(blockId: u32, pin: u8, v: f32): void {
    hostSendPinF32(blockId, pin, v);
  }

  cos(v: f32): f32 {
    return Mathf.cos(v);
  }

  sin(v: f32): f32 {
    return Mathf.sin(v);
  }

  tan(v: f32): f32 {
    return Mathf.tan(v);
  }

  random(): f32 {
    return f32(Math.random());
  }

  now(): u64 {
    return u64(Date.now());
  }

  listenGpioIn(blockId: u32, handler: GpioInHandler): void {
    this.gpioListeners.push(new GpioListener(blockId, handler));
  }

  unlistenGpioIn(blockId: u32): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      if (this.gpioListeners[i].blockId == blockId) {
        this.gpioListeners[i].active = false;
      }
    }
  }

  tick(): void {
    const snapshot = this.intervals.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const interval = snapshot[i];
      if (interval.active) interval.handler.onInterval();
    }
  }

  close(): void {
    const handlers = this.closeHandlers.slice();
    for (let i = 0; i < handlers.length; i++) {
      handlers[i].onClose();
    }
  }

  emitGpioIn(blockId: u32, pinIndex: u8, value: bool): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      const listener = this.gpioListeners[i];
      if (listener.active && listener.blockId == blockId) {
        listener.handler.onGpioIn(pinIndex, value);
      }
    }
  }
}
`;

const MCU_CONTEXT_SOURCE = `import { CloseHandler, ExecutionContext, GpioInHandler, IntervalHandler } from "./context";

@external("env", "sendPinF32")
declare function hostSendPinF32(blockId: u32, pin: u8, value: f32): void;

@external("env", "now")
declare function hostNow(): u64;

class IntervalEntry {
  id: u32;
  period: u32;
  handler: IntervalHandler;
  active: bool;

  constructor(id: u32, period: u32, handler: IntervalHandler) {
    this.id = id;
    this.period = period;
    this.handler = handler;
    this.active = true;
  }
}

class GpioListener {
  blockId: u32;
  handler: GpioInHandler;
  active: bool;

  constructor(blockId: u32, handler: GpioInHandler) {
    this.blockId = blockId;
    this.handler = handler;
    this.active = true;
  }
}

export class McuExecutionContext extends ExecutionContext {
  private nextIntervalId: u32 = 1;
  private intervals: Array<IntervalEntry> = new Array<IntervalEntry>();
  private closeHandlers: Array<CloseHandler> = new Array<CloseHandler>();
  private gpioListeners: Array<GpioListener> = new Array<GpioListener>();

  setInterval(period: u32, handler: IntervalHandler): u32 {
    const id = this.nextIntervalId++;
    this.intervals.push(new IntervalEntry(id, period, handler));
    return id;
  }

  clearInterval(id: u32): void {
    for (let i = 0; i < this.intervals.length; i++) {
      if (this.intervals[i].id == id) {
        this.intervals[i].active = false;
      }
    }
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  sendPinF32(blockId: u32, pin: u8, v: f32): void {
    hostSendPinF32(blockId, pin, v);
  }

  cos(v: f32): f32 {
    return Mathf.cos(v);
  }

  sin(v: f32): f32 {
    return Mathf.sin(v);
  }

  tan(v: f32): f32 {
    return Mathf.tan(v);
  }

  random(): f32 {
    return f32(Math.random());
  }

  now(): u64 {
    return hostNow();
  }

  listenGpioIn(blockId: u32, handler: GpioInHandler): void {
    this.gpioListeners.push(new GpioListener(blockId, handler));
  }

  unlistenGpioIn(blockId: u32): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      if (this.gpioListeners[i].blockId == blockId) {
        this.gpioListeners[i].active = false;
      }
    }
  }

  tick(): void {
    const snapshot = this.intervals.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const interval = snapshot[i];
      if (interval.active) interval.handler.onInterval();
    }
  }

  close(): void {
    const handlers = this.closeHandlers.slice();
    for (let i = 0; i < handlers.length; i++) {
      handlers[i].onClose();
    }
  }

  emitGpioIn(blockId: u32, pinIndex: u8, value: bool): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      const listener = this.gpioListeners[i];
      if (listener.active && listener.blockId == blockId) {
        listener.handler.onGpioIn(pinIndex, value);
      }
    }
  }
}
`;

export const browserContext: CompilerContext = {
  name: "browser",
  getFiles() {
    return { "browser_context.ts": BROWSER_CONTEXT_SOURCE };
  },
  getPrelude() {
    return `${COMMON_PRELUDE_IMPORTS}
import { BrowserExecutionContext } from "./browser_context";

const ec = new BrowserExecutionContext();
`;
  },
  getExports() {
    return `
export function tick(): void { ec.tick(); }
export function close(): void { ec.close(); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
`;
  },
};

export const mcuContext: CompilerContext = {
  name: "mcu",
  getFiles() {
    return { "mcu_context.ts": MCU_CONTEXT_SOURCE };
  },
  getPrelude() {
    return `${COMMON_PRELUDE_IMPORTS}
import { McuExecutionContext } from "./mcu_context";

const ec = new McuExecutionContext();
`;
  },
  getExports() {
    return `
export function tick(): void { ec.tick(); }
export function close(): void { ec.close(); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
`;
  },
};

const contextRegistry = new Map<string, CompilerContext>();
contextRegistry.set(browserContext.name, browserContext);
contextRegistry.set(mcuContext.name, mcuContext);

export function registerCompilerContext(context: CompilerContext): void {
  contextRegistry.set(context.name, context);
}

export function getCompilerContext(name: string): CompilerContext | undefined {
  return contextRegistry.get(name);
}

function wrapDest(streams: string[]): string {
  if (streams.length === 0) return "dest1(new DiscardF32())";
  if (streams.length === 1) return `dest1(${streams[0]})`;
  if (streams.length === 2) return `dest2(${streams[0]}, ${streams[1]})`;
  if (streams.length === 3) return `dest3(${streams[0]}, ${streams[1]}, ${streams[2]})`;
  return `[${streams.join(", ")}]`;
}

export interface CompilerOptions {
  context?: CompilerContext | string;
  files?: Record<string, string>;
}

export class CompilationModel {
  protected context: CompilerContext;
  private files = new Map<string, string>();

  constructor(
    contextOrOptions?: CompilerContext | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    if (typeof contextOrOptions === "string") {
      const resolved = getCompilerContext(contextOrOptions);
      if (!resolved) {
        throw new Error(
          `Unknown compiler context "${contextOrOptions}". Registered: ${[...contextRegistry.keys()].join(", ")}`,
        );
      }
      this.context = resolved;
    } else if (
      contextOrOptions &&
      typeof contextOrOptions === "object" &&
      "name" in contextOrOptions &&
      "getPrelude" in contextOrOptions
    ) {
      this.context = contextOrOptions as CompilerContext;
    } else if (
      contextOrOptions &&
      typeof contextOrOptions === "object" &&
      ("context" in contextOrOptions || "files" in contextOrOptions)
    ) {
      const opts = contextOrOptions as CompilerOptions;
      if (typeof opts.context === "string") {
        const resolved = getCompilerContext(opts.context);
        if (!resolved) {
          throw new Error(
            `Unknown compiler context "${opts.context}". Registered: ${[...contextRegistry.keys()].join(", ")}`,
          );
        }
        this.context = resolved;
      } else if (opts.context) {
        this.context = opts.context;
      } else {
        this.context = browserContext;
      }
      if (opts.files) {
        this.addFiles(opts.files);
      }
    } else if (contextOrOptions && typeof contextOrOptions === "object") {
      this.context = browserContext;
      this.addFiles(contextOrOptions as Record<string, string>);
    } else {
      this.context = browserContext;
    }

    if (initialFiles) {
      this.addFiles(initialFiles);
    }
  }

  getContext(): CompilerContext {
    return this.context;
  }

  setContext(contextOrName: CompilerContext | string): void {
    if (typeof contextOrName === "string") {
      const resolved = getCompilerContext(contextOrName);
      if (!resolved) {
        throw new Error(
          `Unknown compiler context "${contextOrName}". Registered: ${[...contextRegistry.keys()].join(", ")}`,
        );
      }
      this.context = resolved;
    } else {
      this.context = contextOrName;
    }
  }

  addFile(name: string, content: string): void {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    this.files.set(clean, content);
    const slash = clean.lastIndexOf("/");
    if (slash !== -1) {
      const base = clean.slice(slash + 1);
      if (!this.files.has(base)) {
        this.files.set(base, content);
      }
    }
  }

  addFiles(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
      this.addFile(name, content);
    }
  }

  getFile(name: string): string | undefined {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.files.get(clean);
  }

  getFiles(): Record<string, string> {
    const contextFiles = this.context.getFiles ? this.context.getFiles() : {};
    const result: Record<string, string> = { ...contextFiles };
    for (const [key, value] of this.files.entries()) {
      result[key] = value;
    }
    return result;
  }

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
    const outputStreamMap = new Map<string, string>();

    // 1. Generate Sinks
    for (const block of sinks) {
      const numId = blockIdMap.get(block.id) ?? 0;
      const varName = block.id.replace(/[^a-zA-Z0-9_]/g, "_");

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

    const prelude = this.context.getPrelude();
    const exports = this.context.getExports();
    const body = lines.join("\n");
    return `${prelude}\n${body}\n${exports}\n`;
  }

  async compile(
    diagram: Diagram,
    runtime: ASRuntimeLike,
    options?: CompileOptionsLike,
  ): Promise<Uint8Array> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.compileSource(source, this.getFiles(), options);
  }

  async run<TSession extends ASSessionLike = ASSessionLike>(
    diagram: Diagram,
    runtime: ASRuntimeLike<TSession>,
    options?: CompileOptionsLike,
  ): Promise<TSession> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.createSession(source, this.getFiles(), options);
  }
}

export class DiagramCompiler extends CompilationModel {}

export class BrowserCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(browserContext, initialFiles);
  }
}

export class McuCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(mcuContext, initialFiles);
  }
}
