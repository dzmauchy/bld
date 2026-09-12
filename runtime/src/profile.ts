import type { CompileOptions, WasmProgram } from "./program";

export type WasmProfileName = "browser" | "mcu";

export abstract class WasmProfile {
  abstract readonly name: WasmProfileName;

  abstract compile(program: WasmProgram, options?: CompileOptions): Uint8Array;

  emitText(_program: WasmProgram, _options?: CompileOptions): string {
    throw new Error(`Wasm profile "${this.name}" does not emit text`);
  }
}

export type BrowserWasmBackend = {
  compile(program: WasmProgram, options?: CompileOptions): Uint8Array;
  emitText(program: WasmProgram, options?: CompileOptions): string;
};

function missingBrowserBackend(): never {
  throw new Error("Browser wasm backend is not loaded");
}

/** Filled by `./compile` so callers can avoid importing Binaryen until needed. */
export const browserWasmBackend: BrowserWasmBackend = {
  compile: () => missingBrowserBackend(),
  emitText: () => missingBrowserBackend(),
};

export function registerBrowserWasmBackend(backend: BrowserWasmBackend): void {
  browserWasmBackend.compile = backend.compile;
  browserWasmBackend.emitText = backend.emitText;
}

export class BrowserWasmProfile extends WasmProfile {
  readonly name = "browser" as const;

  compile(program: WasmProgram, options?: CompileOptions): Uint8Array {
    return browserWasmBackend.compile(program, options);
  }

  override emitText(program: WasmProgram, options?: CompileOptions): string {
    return browserWasmBackend.emitText(program, options);
  }
}

export class McuWasmProfile extends WasmProfile {
  readonly name = "mcu" as const;

  compile(_program: WasmProgram, _options?: CompileOptions): Uint8Array {
    throw new Error("MCU wasm profile is not implemented");
  }

  override emitText(_program: WasmProgram, _options?: CompileOptions): string {
    throw new Error("MCU wasm profile is not implemented");
  }
}

export const browserProfile = new BrowserWasmProfile();
export const mcuProfile = new McuWasmProfile();

export function getWasmProfile(name: WasmProfileName | WasmProfile): WasmProfile {
  if (typeof name !== "string") return name;
  if (name === "browser") return browserProfile;
  if (name === "mcu") return mcuProfile;
  throw new Error(`Unknown wasm profile "${name}"`);
}
