import binaryen from "binaryen";
import type { CompileOptions, WasmProgram } from "./program";
import type { BlockRegistry } from "./registry";
import { defaultRegistry } from "./registry";
import { BlockEmitter } from "./dsl";
import { BrowserWasmModule } from "./module";
import { registerBrowserWasmBackend } from "./profile";

function copyBinary(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export type CompileProgramOptions = CompileOptions & {
  registry?: BlockRegistry;
};

function buildModule(program: WasmProgram, registry: BlockRegistry): BrowserWasmModule {
  const builder = new BrowserWasmModule();
  const blocks = [...program.blocks].sort(
    (a, b) => registry.priority(a.ref) - registry.priority(b.ref) || a.id - b.id,
  );
  for (const block of blocks) {
    registry.require(block.ref).emit(new BlockEmitter(builder, block));
  }
  builder.finishExports(program);
  return builder;
}

function optimize(mod: binaryen.Module, options: CompileOptions): void {
  if (options.optimizeLevel && options.optimizeLevel > 0) {
    binaryen.setOptimizeLevel(options.optimizeLevel);
    mod.optimize();
  }
}

export function compileBrowserProgram(program: WasmProgram, options: CompileProgramOptions = {}): Uint8Array {
  const registry = options.registry ?? defaultRegistry;
  const builder = buildModule(program, registry);
  const mod = builder.m;
  try {
    optimize(mod, options);
    if (!mod.validate()) {
      throw new Error("Invalid browser wasm module");
    }
    return copyBinary(mod.emitBinary());
  } finally {
    mod.dispose();
  }
}

export function emitBrowserText(program: WasmProgram, options: CompileProgramOptions = {}): string {
  const registry = options.registry ?? defaultRegistry;
  const builder = buildModule(program, registry);
  const mod = builder.m;
  try {
    optimize(mod, options);
    return mod.emitText();
  } finally {
    mod.dispose();
  }
}

registerBrowserWasmBackend({
  compile: compileBrowserProgram,
  emitText: emitBrowserText,
});
