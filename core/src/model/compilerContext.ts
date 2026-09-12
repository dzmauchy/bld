/**
 * @title Compiler Context
 */
export {
  BrowserWasmProfile,
  McuWasmProfile,
  WasmProfile,
  browserProfile,
  getWasmProfile,
  mcuProfile,
  type WasmProfileName,
} from "runtime";

export abstract class CompilerContext {
  abstract readonly name: string;
}

export class BrowserCompilerContext extends CompilerContext {
  readonly name = "browser" as const;
}

export class McuCompilerContext extends CompilerContext {
  readonly name = "mcu" as const;
}

export const browserContext = new BrowserCompilerContext();
export const mcuContext = new McuCompilerContext();

export class CompilerContextRegistry {
  private static readonly _shared = new CompilerContextRegistry();
  static get shared(): CompilerContextRegistry {
    return this._shared;
  }

  private readonly contexts = new Map<string, CompilerContext | { name: string }>([
    ["browser", browserContext],
    ["mcu", mcuContext],
  ]);

  register(context: CompilerContext | { name: string }): void {
    this.contexts.set(context.name, context);
  }

  get(name: string): (CompilerContext | { name: string }) | undefined {
    return this.contexts.get(name);
  }

  names(): string[] {
    return [...this.contexts.keys()];
  }
}

export function registerCompilerContext(context: CompilerContext | { name: string }): void {
  CompilerContextRegistry.shared.register(context);
}

export function getCompilerContext(name: string): (CompilerContext | { name: string }) | undefined {
  return CompilerContextRegistry.shared.get(name);
}
