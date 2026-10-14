/**
 * @title Compiler Context
 */
export type WasmProfileName = "browser" | "mcu";

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
  static readonly shared = new CompilerContextRegistry();

  private readonly contexts = new Map<string, CompilerContext>([
    ["browser", browserContext],
    ["mcu", mcuContext],
  ]);

  register(context: CompilerContext): void {
    this.contexts.set(context.name, context);
  }

  get(name: string): CompilerContext | undefined {
    return this.contexts.get(name);
  }

  names(): string[] {
    return this.contexts.keys().toArray();
  }
}

export const registerCompilerContext = (context: CompilerContext): void =>
  CompilerContextRegistry.shared.register(context);

export const getCompilerContext = (name: string): CompilerContext | undefined =>
  CompilerContextRegistry.shared.get(name);
