import binaryen from "binaryen";
import type { DiagramJson, WasmProfileName } from "./json";
import type { CompileOptions, WasmProgram } from "./program";
import { BlockRegistry, defaultRegistry } from "./registry";
import { BlockEmitter } from "./dsl";
import { BrowserWasmModule } from "./module";
import { registerBrowserWasmBackend, getWasmProfile } from "./profile";
import { planDiagramJson } from "./plan";
import { installLibraryFromUrl, type FetchText, type ImportModule } from "./api";

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

export { BlockEmitter } from "./dsl";

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

export type CompileRequest = {
  diagram: DiagramJson;
  /** URLs of `library.schema.json` manifests. */
  libraries: string[];
  profile?: WasmProfileName;
  optimizeLevel?: number;
  debug?: boolean;
  fetchText?: FetchText;
  importModule?: ImportModule;
  registry?: BlockRegistry;
};

async function registryForRequest(request: CompileRequest): Promise<BlockRegistry> {
  if (request.registry) return request.registry;
  const registry = new BlockRegistry();
  for (const url of request.libraries) {
    const options: { registry: BlockRegistry; fetchText?: FetchText; importModule?: ImportModule } = {
      registry,
    };
    if (request.fetchText) options.fetchText = request.fetchText;
    if (request.importModule) options.importModule = request.importModule;
    await installLibraryFromUrl(url, options);
  }
  return registry;
}

function requestCompileOptions(request: CompileRequest): CompileOptions {
  const options: CompileOptions = {};
  if (request.debug !== undefined) options.debug = request.debug;
  if (request.optimizeLevel !== undefined) options.optimizeLevel = request.optimizeLevel;
  return options;
}

export async function compileDiagram(request: CompileRequest): Promise<Uint8Array> {
  const profile = getWasmProfile(request.profile ?? "browser");
  const registry = await registryForRequest(request);
  const program = planDiagramJson(request.diagram, registry);
  if (profile.name === "browser") {
    return compileBrowserProgram(program, { ...requestCompileOptions(request), registry });
  }
  return profile.compile(program, requestCompileOptions(request));
}

export async function emitDiagramText(request: CompileRequest): Promise<string> {
  const profile = getWasmProfile(request.profile ?? "browser");
  const registry = await registryForRequest(request);
  const program = planDiagramJson(request.diagram, registry);
  if (profile.name === "browser") {
    return emitBrowserText(program, { ...requestCompileOptions(request), registry });
  }
  return profile.emitText(program, requestCompileOptions(request));
}

