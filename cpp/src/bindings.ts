export type HostEnvCallbacks = {
  sendPinF32?: (blockId: number, pin: number, value: number) => void;
};

/**
 * Linear memory exported by a linked diagram. Syscalls read it after instantiation.
 */
class LinearMemory {
  private memory: WebAssembly.Memory | undefined;

  bind(instance: WebAssembly.Instance): void {
    const memory = instance.exports["memory"];
    if (memory instanceof WebAssembly.Memory) this.memory = memory;
  }

  private require(): WebAssembly.Memory {
    if (!this.memory) throw new Error("wasm module has no exported memory");
    return this.memory;
  }

  private view(): DataView {
    return new DataView(this.require().buffer);
  }

  u32(ptr: number): number {
    return this.view().getUint32(ptr, true);
  }

  setU32(ptr: number, value: number): void {
    this.view().setUint32(ptr, value, true);
  }

  setU64(ptr: number, value: bigint): void {
    this.view().setBigUint64(ptr, value, true);
  }

  bytes(ptr: number, length: number): Uint8Array {
    const memory = this.require();
    return new Uint8Array(memory.buffer, ptr, length);
  }
}

/**
 * One import module supplied to a browser wasm instance.
 */
abstract class WasmImportModule {
  abstract readonly moduleName: string;
  abstract functions(): WebAssembly.ModuleImports;
}

/**
 * Diagram host functions. Generated C++ calls these instead of a JS runtime.
 */
class DiagramHostImports extends WasmImportModule {
  readonly moduleName = "env";

  constructor(private readonly host: HostEnvCallbacks) {
    super();
  }

  functions(): WebAssembly.ModuleImports {
    return {
      host_add: (left: number, right: number) => left + right,
      host_sendPinF32: (blockId: number, pin: number, value: number) => {
        this.host.sendPinF32?.(blockId, pin, value);
      },
      abort: () => {
        throw new Error("env.abort");
      },
      emscripten_notify_memory_growth: () => {},
    };
  }
}

/**
 * Syscalls imported by the prebuilt Emscripten standalone libc.
 * The import module name is `wasi_snapshot_preview1` because that is how
 * those archives were built. The browser compile target is Emscripten.
 */
class StandaloneLibcImports extends WasmImportModule {
  readonly moduleName = "wasi_snapshot_preview1";

  constructor(private readonly memory: LinearMemory) {
    super();
  }

  functions(): WebAssembly.ModuleImports {
    return {
      args_get: () => 0,
      args_sizes_get: (argcPtr: number, bufPtr: number) => {
        this.memory.setU32(argcPtr, 0);
        this.memory.setU32(bufPtr, 0);
        return 0;
      },
      environ_get: () => 0,
      environ_sizes_get: (countPtr: number, bufPtr: number) => {
        this.memory.setU32(countPtr, 0);
        this.memory.setU32(bufPtr, 0);
        return 0;
      },
      clock_res_get: (_id: number, ptr: number) => {
        this.memory.setU64(ptr, 1_000_000n);
        return 0;
      },
      clock_time_get: (_id: number, _precision: number, ptr: number) => {
        this.memory.setU64(ptr, BigInt(Date.now()) * 1_000_000n);
        return 0;
      },
      fd_close: () => 0,
      fd_fdstat_get: () => 0,
      fd_pread: (_fd: number, _iovPtr: number, _iovCnt: number, _offset: bigint, nreadPtr: number) => {
        this.memory.setU32(nreadPtr, 0);
        return 0;
      },
      fd_pwrite: (_fd: number, _iovPtr: number, _iovCnt: number, _offset: bigint, nwrittenPtr: number) => {
        this.memory.setU32(nwrittenPtr, 0);
        return 0;
      },
      fd_read: (_fd: number, _iovPtr: number, _iovCnt: number, nreadPtr: number) => {
        this.memory.setU32(nreadPtr, 0);
        return 0;
      },
      fd_seek: () => 0,
      fd_sync: () => 0,
      fd_write: (fd: number, iovPtr: number, iovCnt: number, nwrittenPtr: number) => {
        let written = 0;
        for (let i = 0; i < iovCnt; i += 1) {
          const base = iovPtr + i * 8;
          const ptr = this.memory.u32(base);
          const len = this.memory.u32(base + 4);
          const text = new TextDecoder().decode(this.memory.bytes(ptr, len));
          if (fd === 2) console.error(text);
          else console.log(text);
          written += len;
        }
        this.memory.setU32(nwrittenPtr, written);
        return 0;
      },
      proc_exit: (code: number) => {
        throw new Error(`proc_exit ${code}`);
      },
      random_get: (ptr: number, len: number) => {
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        this.memory.bytes(ptr, len).set(bytes);
        return 0;
      },
    };
  }
}

/**
 * Instantiates browser diagrams compiled for wasm32-unknown-emscripten.
 */
export class DefaultWasmBindings {
  private readonly memory = new LinearMemory();
  private readonly modules: readonly WasmImportModule[];

  private constructor(host: HostEnvCallbacks) {
    this.modules = [
      new DiagramHostImports(host),
      new StandaloneLibcImports(this.memory),
    ];
  }

  static open(host: HostEnvCallbacks = {}): DefaultWasmBindings {
    return new DefaultWasmBindings(host);
  }

  async instantiate(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    const instance = await WebAssembly.instantiate(module, this.importObject(module));
    this.memory.bind(instance);
    return instance;
  }

  private importObject(module: WebAssembly.Module): WebAssembly.Imports {
    const imports: WebAssembly.Imports = {};
    for (const provider of this.modules) {
      imports[provider.moduleName] = provider.functions();
    }
    for (const descriptor of WebAssembly.Module.imports(module)) {
      const group = imports[descriptor.module] ?? (imports[descriptor.module] = {});
      if (descriptor.name in group) continue;
      group[descriptor.name] = this.placeholder(descriptor.kind);
    }
    return imports;
  }

  private placeholder(kind: WebAssembly.ImportExportKind): WebAssembly.ModuleImports[string] {
    if (kind === "function") return () => 0;
    if (kind === "memory") return new WebAssembly.Memory({ initial: 256, maximum: 4096 });
    if (kind === "table") return new WebAssembly.Table({ initial: 1, element: "anyfunc" });
    if (kind === "global") return new WebAssembly.Global({ value: "i32", mutable: true }, 0);
    throw new Error(`unsupported wasm import kind ${kind}`);
  }
}
