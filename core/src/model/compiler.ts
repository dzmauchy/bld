/**
 * @title Diagram Compiler
 */
import type { Diagram } from "./diagram";
import { normalizeAssetPath } from "./appAssets";
import { ClangAstDumper, CompilationProgressEmitter, type CompilationPhaseListener, type ICppCompiler } from "cpp";
import { CppDiagramBuilder, type DiagramDiagnostic } from "./cppBuilder";
import { defaultCppBlockCatalog } from "./cppBlockCatalog";

export type { ICppCompiler };
export { CppDiagramBuilder } from "./cppBuilder";
export {
  CppBlockCatalog,
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
  onPhase?: CompilationPhaseListener;
}

export interface WasmRuntimeLike<TSession extends WasmSessionLike = WasmSessionLike> {
  instantiate(wasm: Uint8Array): Promise<TSession>;
}

export interface CompilerOptions {
  profile?: WasmProfileName;
  files?: Record<string, string>;
  cppCompiler?: ICppCompiler;
}

export class CompilationModel extends CompilationProgressEmitter {
  protected profile: WasmProfileName;
  protected readonly cppCompiler: ICppCompiler | undefined;
  private readonly files = new Map<string, string>();

  constructor(
    profileOrOptions?: WasmProfileName | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    super();
    const parsed = CompilationModel.parseConstructorArgs(profileOrOptions);
    this.profile = parsed.profile ?? "browser";
    this.cppCompiler = parsed.cppCompiler;
    if (parsed.files) this.addFiles(parsed.files);
    if (initialFiles) this.addFiles(initialFiles);
  }

  private static parseConstructorArgs(
    profileOrOptions?: WasmProfileName | CompilerOptions | Record<string, string>,
  ): CompilerOptions {
    if (profileOrOptions === "browser" || profileOrOptions === "mcu") {
      return { profile: profileOrOptions };
    }
    if (!profileOrOptions || typeof profileOrOptions !== "object") return {};
    return "profile" in profileOrOptions || "files" in profileOrOptions || "cppCompiler" in profileOrOptions
      ? profileOrOptions as CompilerOptions
      : { files: profileOrOptions as Record<string, string> };
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
    this.files.set(normalizeAssetPath(name), content);
  }

  addFiles(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) this.addFile(name, content);
  }

  getFile(name: string): string | undefined {
    return this.files.get(normalizeAssetPath(name));
  }

  getFiles(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}

export class DiagramCompiler extends CompilationModel {
  emitFiles(diagram: Diagram): Map<string, string> {
    return new CppDiagramBuilder({ ...ClangAstDumper.libraryFiles, ...this.getFiles() }).build(diagram);
  }

  emitText(diagram: Diagram): string {
    return this.emitFiles(diagram).get("diagram.cpp") ?? "";
  }

  async compile(diagram: Diagram, options?: CompileOptionsLike): Promise<Uint8Array> {
    if (this.profile === "mcu") {
      throw new Error("MCU wasm profile is not implemented");
    }
    if (!this.cppCompiler) {
      throw new Error("C++ compiler backend is required");
    }
    const builder = new CppDiagramBuilder({ ...ClangAstDumper.libraryFiles, ...this.getFiles() });
    const invalid = builder.validate(diagram);
    if (invalid) {
      invalid.assignTo(diagram);
      throw new DiagramCompilationError(invalid.diagnostics);
    }
    try {
      const wasm = await builder.compile(diagram, this.cppCompiler, (event) => this.notifyPhase(event, options?.onPhase));
      for (const block of diagram.getBlocks()) {
        for (const port of [...block.inputPorts, ...block.outputPorts]) port.assignAnalysis(port.inferredType, []);
      }
      return wasm;
    } catch (error) {
      throw new DiagramCompilationError(builder.compilationFailure(diagram, error).diagnostics);
    }
  }

  async run<TSession extends WasmSessionLike = WasmSessionLike>(
    diagram: Diagram,
    runtime: WasmRuntimeLike<TSession>,
    options?: CompileOptionsLike,
  ): Promise<TSession> {
    const wasm = await this.compile(diagram, options);
    this.notifyPhase({ phase: "running", status: "active" }, options?.onPhase);
    const session = await runtime.instantiate(wasm);
    this.notifyPhase({ phase: "running", status: "completed" }, options?.onPhase);
    return session;
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

export class DiagramCompilationError extends Error {
  constructor(readonly diagnostics: DiagramDiagnostic[]) {
    super(diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("\n"));
  }
}
