export type HostEnvCallbacks = {
  sendPinF32?: (blockId: number, pin: number, value: number) => void;
  printChar?: (character: number) => void;
};

/** Browser imports for the freestanding runtime and base library. */
export class DefaultWasmBindings {
  private readonly outputDecoder = new TextDecoder();
  private outputLine = "";

  constructor(private readonly host: HostEnvCallbacks = {}) {}

  env(): WebAssembly.ModuleImports {
    return {
      sin: Math.sin,
      cos: Math.cos,
      fmod: (value: number, divisor: number) => value % divisor,
      js_print_char: (character: number) => this.printChar(character),
      js_now: () => performance.now(),
      js_time: () => Date.now(),
      host_sendPinF32: (blockId: number, pin: number, value: number) => {
        this.host.sendPinF32?.(blockId, pin, value);
      },
      host_sendPinF64: (blockId: number, pin: number, value: number) => {
        this.host.sendPinF32?.(blockId, pin, value);
      },
    };
  }

  private printChar(character: number): void {
    const byte = character & 255;
    if (this.host.printChar) {
      this.host.printChar(byte);
      return;
    }
    this.outputLine += this.outputDecoder.decode(new Uint8Array([byte]), { stream: true });
    if (byte === 10) {
      console.log(this.outputLine.slice(0, -1));
      this.outputLine = "";
    }
  }

  fill(module: WebAssembly.Module): WebAssembly.Imports {
    const env = this.env();
    const imports: WebAssembly.Imports = { env };
    for (const descriptor of WebAssembly.Module.imports(module)) {
      if (descriptor.module !== "env") throw new Error(`unsupported wasm import module ${descriptor.module}`);
      if (descriptor.kind !== "function" || !Object.hasOwn(env, descriptor.name)) {
        throw new Error(`unsupported wasm import ${descriptor.module}.${descriptor.name} (${descriptor.kind})`);
      }
    }

    return imports;
  }
}
