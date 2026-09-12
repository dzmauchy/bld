import type { CompileOptions, WasmProgram } from "./program";

export type WasmProfileName = "browser" | "mcu";

export abstract class WasmProfile {
  abstract readonly name: WasmProfileName;

  abstract compile(program: WasmProgram, options?: CompileOptions): Uint8Array;

  emitText(_program: WasmProgram, _options?: CompileOptions): string {
    throw new Error(`Wasm profile "${this.name}" does not emit text`);
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

export const mcuProfile = new McuWasmProfile();
