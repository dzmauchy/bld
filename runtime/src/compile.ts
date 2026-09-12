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

function withModule<T>(program: WasmProgram, options: CompileProgramOptions, fn: (mod: binaryen.Module) => T): T {
  const mod = buildModule(program, options.registry ?? defaultRegistry).m;
  try {
    optimize(mod, options);
    return fn(mod);
  } finally {
    mod.dispose();
  }
}

export function compileBrowserProgram(program: WasmProgram, options: CompileProgramOptions = {}): Uint8Array {
  return withModule(program, options, (mod) => {
    if (!mod.validate()) throw new Error("Invalid browser wasm module");
    return copyBinary(mod.emitBinary());
  });
}

export { BlockEmitter } from "./dsl";

export function emitBrowserText(program: WasmProgram, options: CompileProgramOptions = {}): string {
  return withModule(program, options, (mod) => mod.emitText());
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
    const options: { registry: BlockRegistry; fetchText?: FetchText; importModule?: ImportModule } = { registry };
    if (request.fetchText) options.fetchText = request.fetchText;
    if (request.importModule) options.importModule = request.importModule;
    await installLibraryFromUrl(url, options);
  }
  return registry;
}

async function prepareCompile(request: CompileRequest) {
  const profile = getWasmProfile(request.profile ?? "browser");
  const registry = await registryForRequest(request);
  const program = planDiagramJson(request.diagram, registry);
  const options: CompileProgramOptions = { registry };
  if (request.debug !== undefined) options.debug = request.debug;
  if (request.optimizeLevel !== undefined) options.optimizeLevel = request.optimizeLevel;
  return { profile, program, options };
}

export async function compileDiagram(request: CompileRequest): Promise<Uint8Array> {
  const { profile, program, options } = await prepareCompile(request);
  return profile.name === "browser" ? compileBrowserProgram(program, options) : profile.compile(program, options);
}

export async function emitDiagramText(request: CompileRequest): Promise<string> {
  const { profile, program, options } = await prepareCompile(request);
  return profile.name === "browser" ? emitBrowserText(program, options) : profile.emitText(program, options);
}

