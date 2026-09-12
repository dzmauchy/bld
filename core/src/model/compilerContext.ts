/**
 * @title Compiler Context
 */
export const COMMON_PRELUDE_IMPORTS = `import { Block, DiscardF32, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./context";
import { const_f32, cos_f32, cos_gen_f32, gpio_in, product_f32, pulse_gen_f32, rand_gen_f32, scope_f32, sin_f32, sin_gen_f32 } from "./blocks";`;

const DEFAULT_EXPORTS = `
export function tick(): void { ec.tick(); }
export function close(): void { ec.close(); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
`;

export class CompilerContext {
  constructor(
    readonly name: string,
    private readonly filesProvider: () => Record<string, string> = () => ({}),
    private readonly preludeProvider: () => string = () => "",
    private readonly exportsProvider: () => string = () => "",
  ) {}

  getFiles(): Record<string, string> {
    return this.filesProvider();
  }

  getPrelude(): string {
    return this.preludeProvider();
  }

  getExports(): string {
    return this.exportsProvider();
  }

  static isContextLike(value: unknown): value is CompilerContext {
    return (
      value instanceof CompilerContext ||
      (typeof value === "object" &&
        value !== null &&
        "name" in value &&
        typeof (value as CompilerContext).name === "string" &&
        typeof (value as CompilerContext).getPrelude === "function" &&
        typeof (value as CompilerContext).getExports === "function")
    );
  }

  static from(value: CompilerContext | { name: string; getFiles?(): Record<string, string>; getPrelude(): string; getExports(): string }): CompilerContext {
    if (value instanceof CompilerContext) return value;
    return new CompilerContext(
      value.name,
      () => value.getFiles?.() ?? {},
      () => value.getPrelude(),
      () => value.getExports(),
    );
  }
}

export abstract class HostCompilerContext extends CompilerContext {
  abstract readonly contextClassName: string;
  abstract readonly contextFileName: string;

  constructor(name: string) {
    super(name);
  }

  protected contextPreamble(): string {
    return `@external("env", "sendPinF32")
declare function hostSendPinF32(blockId: u32, pin: u8, value: f32): void;
`;
  }

  protected abstract nowExpression(): string;

  override getFiles(): Record<string, string> {
    return { [this.contextFileName]: this.generateContextSource() };
  }

  override getPrelude(): string {
    const moduleName = this.contextFileName.replace(/\.ts$/, "");
    return `${COMMON_PRELUDE_IMPORTS}
import { ${this.contextClassName} } from "./${moduleName}";

const ec = new ${this.contextClassName}();
`;
  }

  override getExports(): string {
    return DEFAULT_EXPORTS;
  }

  generateContextSource(): string {
    return `import { CloseHandler, ExecutionContext, GpioInHandler, IntervalHandler } from "./context";

${this.contextPreamble()}
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

export class ${this.contextClassName} extends ExecutionContext {
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
    return ${this.nowExpression()};
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
  }
}

export class BrowserCompilerContext extends HostCompilerContext {
  readonly contextClassName = "BrowserExecutionContext";
  readonly contextFileName = "browser_context.ts";

  constructor() {
    super("browser");
  }

  protected nowExpression(): string {
    return "u64(Date.now())";
  }
}

export class McuCompilerContext extends HostCompilerContext {
  readonly contextClassName = "McuExecutionContext";
  readonly contextFileName = "mcu_context.ts";

  constructor() {
    super("mcu");
  }

  protected override contextPreamble(): string {
    return `${super.contextPreamble()}
@external("env", "now")
declare function hostNow(): u64;
`;
  }

  protected nowExpression(): string {
    return "hostNow()";
  }
}

export class CompilerContextRegistry {
  static readonly shared = new CompilerContextRegistry();

  private readonly contexts = new Map<string, CompilerContext>();

  register(context: CompilerContext): void {
    this.contexts.set(context.name, context);
  }

  get(name: string): CompilerContext | undefined {
    return this.contexts.get(name);
  }

  names(): string[] {
    return [...this.contexts.keys()];
  }

  resolve(contextOrName: CompilerContext | string): CompilerContext {
    if (typeof contextOrName !== "string") {
      return CompilerContext.from(contextOrName);
    }
    const resolved = this.get(contextOrName);
    if (!resolved) {
      throw new Error(
        `Unknown compiler context "${contextOrName}". Registered: ${this.names().join(", ")}`,
      );
    }
    return resolved;
  }
}

export const browserContext = new BrowserCompilerContext();
export const mcuContext = new McuCompilerContext();

CompilerContextRegistry.shared.register(browserContext);
CompilerContextRegistry.shared.register(mcuContext);

export function registerCompilerContext(context: CompilerContext): void {
  CompilerContextRegistry.shared.register(CompilerContext.from(context));
}

export function getCompilerContext(name: string): CompilerContext | undefined {
  return CompilerContextRegistry.shared.get(name);
}
