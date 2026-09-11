export type MemoryGetter = () => WebAssembly.Memory;

function u32(memory: WebAssembly.Memory, ptr: number): number {
  return new DataView(memory.buffer).getUint32(ptr, true);
}

function setU32(memory: WebAssembly.Memory, ptr: number, value: number): void {
  new DataView(memory.buffer).setUint32(ptr, value, true);
}

/**
 * Minimal WASI preview1 + env stubs so standalone clang/lld output can instantiate.
 */
export type HostEnvCallbacks = {
  sendPinF32?: (blockId: number, pin: number, value: number) => void;
};

export class DefaultWasmBindings {
  constructor(
    private readonly getMemory: MemoryGetter,
    private readonly host: HostEnvCallbacks = {},
  ) {}

  env(): WebAssembly.ModuleImports {
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

  wasi(): WebAssembly.ModuleImports {
    return {
      args_get: () => 0,
      args_sizes_get: (argcPtr: number, bufPtr: number) => {
        const memory = this.getMemory();
        setU32(memory, argcPtr, 0);
        setU32(memory, bufPtr, 0);
        return 0;
      },
      environ_get: () => 0,
      environ_sizes_get: (countPtr: number, bufPtr: number) => {
        const memory = this.getMemory();
        setU32(memory, countPtr, 0);
        setU32(memory, bufPtr, 0);
        return 0;
      },
      clock_time_get: (_id: number, _precision: number, ptr: number) => {
        const memory = this.getMemory();
        const now = BigInt(Date.now()) * 1_000_000n;
        new DataView(memory.buffer).setBigUint64(ptr, now, true);
        return 0;
      },
      fd_close: () => 0,
      fd_fdstat_get: () => 0,
      fd_seek: () => 0,
      fd_write: (fd: number, iovPtr: number, iovCnt: number, nwrittenPtr: number) => {
        const memory = this.getMemory();
        let written = 0;
        for (let i = 0; i < iovCnt; i += 1) {
          const base = iovPtr + i * 8;
          const ptr = u32(memory, base);
          const len = u32(memory, base + 4);
          const bytes = new Uint8Array(memory.buffer, ptr, len);
          const text = new TextDecoder().decode(bytes);
          if (fd === 2) console.error(text);
          else console.log(text);
          written += len;
        }
        setU32(memory, nwrittenPtr, written);
        return 0;
      },
      fd_read: (_fd: number, _iovPtr: number, _iovCnt: number, nreadPtr: number) => {
        setU32(this.getMemory(), nreadPtr, 0);
        return 0;
      },
      fd_prestat_get: () => 8,
      fd_prestat_dir_name: () => 8,
      proc_exit: (code: number) => {
        throw new Error(`proc_exit ${code}`);
      },
      random_get: (ptr: number, len: number) => {
        const memory = this.getMemory();
        crypto.getRandomValues(new Uint8Array(memory.buffer, ptr, len));
        return 0;
      },
      sched_yield: () => 0,
    };
  }

  fill(module: WebAssembly.Module): WebAssembly.Imports {
    const imports: WebAssembly.Imports = {
      env: this.env(),
      wasi_snapshot_preview1: this.wasi(),
    };
    for (const descriptor of WebAssembly.Module.imports(module)) {
      const group = imports[descriptor.module] ?? (imports[descriptor.module] = {});
      if (descriptor.name in group) continue;
      if (descriptor.kind === "function") {
        group[descriptor.name] = () => 0;
      } else if (descriptor.kind === "memory") {
        group[descriptor.name] = new WebAssembly.Memory({ initial: 256, maximum: 4096 });
      } else if (descriptor.kind === "table") {
        group[descriptor.name] = new WebAssembly.Table({ initial: 1, element: "anyfunc" });
      } else if (descriptor.kind === "global") {
        group[descriptor.name] = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
      }
    }
    return imports;
  }
}
