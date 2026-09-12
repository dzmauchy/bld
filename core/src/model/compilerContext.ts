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

export const browserContext = {
  name: "browser" as const,
};

export const mcuContext = {
  name: "mcu" as const,
};

const registered = new Map<string, { name: string }>([
  ["browser", browserContext],
  ["mcu", mcuContext],
]);

export class CompilerContextRegistry {
  static readonly shared = new CompilerContextRegistry();

  register(context: { name: string }): void {
    registered.set(context.name, context);
  }

  get(name: string): { name: string } | undefined {
    return registered.get(name);
  }

  names(): string[] {
    return [...registered.keys()];
  }
}

export function registerCompilerContext(context: { name: string }): void {
  CompilerContextRegistry.shared.register(context);
}

export function getCompilerContext(name: string): { name: string } | undefined {
  return CompilerContextRegistry.shared.get(name);
}
