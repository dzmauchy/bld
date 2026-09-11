/**
 * @title Diagram Compiler
 */
import type { Diagram } from "./diagram";
import { normalizeAssetPath } from "./appAssets";
import { CppDiagramBuilder, type ICppCompiler } from "./cppBuilder";
import { defaultCppBlockCatalog } from "./cppBlockCatalog";

export type { ICppCompiler };
export { CppDiagramBuilder } from "./cppBuilder";
export {
  BlockPortTopology,
  CppBlockCatalog,
  CppTypeNames,
  defaultCppBlockCatalog,
} from "./cppBlockCatalog";
export {
  CompilerContext,
  BrowserCompilerContext,
  McuCompilerContext,
  browserContext,
  mcuContext,
  CompilerContextRegistry,
  getCompilerContext,
  registerCompilerContext,
} from "./compilerContext";

export type WasmProfileName = "browser" | "mcu";

export interface WasmSessionLike {
  tick(): Promise<number>;
  tickThenObserve(): Promise<number>;
  setNow(ms: number): Promise<number>;
  setRandom(value: number): Promise<number>;
  emitGpioIn(blockId: number, pinIndex: number, value: boolean): Promise<number>;
  close(): Promise<number>;
  clearPins(): Promise<number>;
  lastPin(blockId: number, pin: number): Promise<number>;
  hasPin(blockId: number, pin: number): Promise<boolean>;
  pinWriteCount(): Promise<number>;
  activeIntervalCount(): Promise<number>;
  intervalPeriodAt(index: number): Promise<number>;
  activeGpioListenerCount(): Promise<number>;
  call(name: string, ...args: number[]): Promise<number>;
}

export interface CompileOptionsLike {
  debug?: boolean;
}

export interface WasmRuntimeLike<TSession extends WasmSessionLike = WasmSessionLike> {
  instantiate(wasm: Uint8Array): Promise<TSession>;
}

export interface CompilerOptions {
  profile?: WasmProfileName;
  files?: Record<string, string>;
  cppCompiler?: ICppCompiler;
}

export class CompilationModel {
  protected profile: WasmProfileName;
  private readonly files = new Map<string, string>();

  constructor(
    profileOrOptions?: WasmProfileName | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    const parsed = CompilationModel.parseConstructorArgs(profileOrOptions);
    this.profile = parsed.profile;
    if (parsed.files) this.addFiles(parsed.files);
    if (initialFiles) this.addFiles(initialFiles);
  }

  private static parseConstructorArgs(
    profileOrOptions?: WasmProfileName | CompilerOptions | Record<string, string>,
  ): { profile: WasmProfileName; files?: Record<string, string>; cppCompiler?: ICppCompiler } {
    if (profileOrOptions === "browser" || profileOrOptions === "mcu") {
      return { profile: profileOrOptions };
    }
    if (
      profileOrOptions &&
      typeof profileOrOptions === "object" &&
      ("profile" in profileOrOptions || "files" in profileOrOptions || "cppCompiler" in profileOrOptions)
    ) {
      const opts = profileOrOptions as CompilerOptions;
      return {
        profile: opts.profile ?? "browser",
        ...(opts.files ? { files: opts.files } : {}),
        ...(opts.cppCompiler ? { cppCompiler: opts.cppCompiler } : {}),
      };
    }
    if (profileOrOptions && typeof profileOrOptions === "object") {
      return { profile: "browser", files: profileOrOptions as Record<string, string> };
    }
    return { profile: "browser" };
  }

  getProfile(): { name: WasmProfileName } {
    return { name: this.profile };
  }

  getContext(): { name: string } {
    return this.getProfile();
  }

  setProfile(profile: WasmProfileName): void {
    this.profile = profile;
  }

  setContext(profile: string): void {
    this.setProfile(profile as WasmProfileName);
  }

  addFile(name: string, content: string): void {
    const clean = normalizeAssetPath(name);
    this.files.set(clean, content);
    const slash = clean.lastIndexOf("/");
    if (slash !== -1) {
      const base = clean.slice(slash + 1);
      if (!this.files.has(base)) this.files.set(base, content);
    }
  }

  addFiles(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) this.addFile(name, content);
  }

  getFile(name: string): string | undefined {
    const clean = normalizeAssetPath(name);
    return this.files.get(clean);
  }

  getFiles(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

export class DiagramCompiler extends CompilationModel {
  protected readonly cppCompiler: ICppCompiler | undefined;

  constructor(
    profileOrOptions?: WasmProfileName | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    super(profileOrOptions, initialFiles);
    const parsed = profileOrOptions && typeof profileOrOptions === "object" && "cppCompiler" in profileOrOptions
      ? (profileOrOptions as CompilerOptions).cppCompiler
      : undefined;
    this.cppCompiler = parsed;
  }

  emitFiles(diagram: Diagram): Map<string, string> {
    return new CppDiagramBuilder(this.getFiles()).build(diagram);
  }

  emitText(diagram: Diagram): string {
    return this.emitFiles(diagram).get("diagram.cpp") ?? "";
  }

  async compile(diagram: Diagram, _options?: CompileOptionsLike): Promise<Uint8Array> {
    if (this.profile === "mcu") {
      throw new Error("MCU wasm profile is not implemented");
    }
    if (!this.cppCompiler) {
      throw new Error("C++ compiler backend is required");
    }
    return this.cppCompiler.compile(this.emitFiles(diagram));
  }

  async run<TSession extends WasmSessionLike = WasmSessionLike>(
    diagram: Diagram,
    runtime: WasmRuntimeLike<TSession>,
    options?: CompileOptionsLike,
  ): Promise<TSession> {
    const wasm = await this.compile(diagram, options);
    return runtime.instantiate(wasm);
  }
}

export class BrowserCompiler extends DiagramCompiler {
  constructor(libraryFiles: Record<string, string> = {}, cppCompiler?: ICppCompiler) {
    super({ profile: "browser", files: libraryFiles, ...(cppCompiler ? { cppCompiler } : {}) });
  }
}

export class McuCompiler extends DiagramCompiler {
  constructor(libraryFiles: Record<string, string> = {}) {
    super({ profile: "mcu", files: libraryFiles });
  }
}

export const defaultBlockEmitters = {
  has(ref: string): boolean {
    return defaultCppBlockCatalog.has(ref);
  },
};
