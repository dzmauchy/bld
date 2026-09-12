/**
 * @title Diagram Compiler
 */
import type { Diagram } from "./diagram";
import {
  browserProfile,
  defaultRegistry,
  getWasmProfile,
  mcuProfile,
  planProgram,
  WasmProfile,
  type CompileOptions,
  type DownstreamRef,
  type PlannedBlock,
  type WasmProgram,
  type WasmProfileName,
} from "runtime";

export { browserProfile, mcuProfile, WasmProfile, getWasmProfile };
export type { CompileOptions, PlannedBlock, WasmProgram, WasmProfileName, DownstreamRef };
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
export { defaultBlockEmitters } from "./blockEmitters";

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
  optimizeLevel?: number;
}

export interface WasmRuntimeLike<TSession extends WasmSessionLike = WasmSessionLike> {
  instantiate(wasm: Uint8Array): Promise<TSession>;
}

export interface CompilerOptions {
  profile?: WasmProfile | WasmProfileName;
  files?: Record<string, string>;
}

export class CompilationModel {
  protected profile: WasmProfile;
  private files = new Map<string, string>();

  constructor(
    profileOrOptions?: WasmProfile | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    const parsed = CompilationModel.parseConstructorArgs(profileOrOptions);
    this.profile = parsed.profile;
    if (parsed.files) this.addFiles(parsed.files);
    if (initialFiles) this.addFiles(initialFiles);
  }

  private static parseConstructorArgs(
    profileOrOptions?: WasmProfile | string | CompilerOptions | Record<string, string>,
  ): { profile: WasmProfile; files?: Record<string, string> } {
    if (typeof profileOrOptions === "string") {
      return { profile: getWasmProfile(profileOrOptions as WasmProfileName) };
    }
    if (profileOrOptions instanceof WasmProfile) {
      return { profile: profileOrOptions };
    }
    if (
      profileOrOptions &&
      typeof profileOrOptions === "object" &&
      ("profile" in profileOrOptions || "files" in profileOrOptions)
    ) {
      const opts = profileOrOptions as CompilerOptions;
      const profile = opts.profile ? getWasmProfile(opts.profile) : browserProfile;
      if (opts.files) return { profile, files: opts.files };
      return { profile };
    }
    if (profileOrOptions && typeof profileOrOptions === "object") {
      return { profile: browserProfile, files: profileOrOptions as Record<string, string> };
    }
    return { profile: browserProfile };
  }

  getProfile(): WasmProfile {
    return this.profile;
  }

  /** @deprecated Use getProfile().name */
  getContext(): { name: string } {
    return this.profile;
  }

  setProfile(profileOrName: WasmProfile | WasmProfileName): void {
    this.profile = getWasmProfile(profileOrName);
  }

  setContext(profileOrName: WasmProfile | string): void {
    this.setProfile(profileOrName as WasmProfile | WasmProfileName);
  }

  addFile(name: string, content: string): void {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
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
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.files.get(clean);
  }

  getFiles(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.files.entries()) result[key] = value;
    return result;
  }
}

export interface IDiagramPlanner {
  plan(diagram: Diagram): WasmProgram;
}

export class DefaultDiagramPlanner implements IDiagramPlanner {
  constructor(private readonly registry = defaultRegistry) {}

  plan(diagram: Diagram): WasmProgram {
    return planProgram(
      {
        blocks: diagram.getBlocks().map((block) => ({
          id: block.id,
          ref: block.ref,
          conf: block.getAllConf(),
        })),
        connections: diagram.getConnections().map((connection) => ({
          from: {
            blockId: connection.from.blockId,
            portId: connection.from.portId,
            vectorIndex: connection.from.vectorIndex,
          },
          to: {
            blockId: connection.to.blockId,
            portId: connection.to.portId,
            vectorIndex: connection.to.vectorIndex,
          },
        })),
      },
      this.registry,
    );
  }
}

export function planDiagram(diagram: Diagram): WasmProgram {
  return new DefaultDiagramPlanner().plan(diagram);
}

export class DiagramCompiler extends CompilationModel {
  private readonly planner: IDiagramPlanner;

  constructor(
    profileOrOptions?: WasmProfile | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
    planner: IDiagramPlanner = new DefaultDiagramPlanner(),
  ) {
    super(profileOrOptions, initialFiles);
    this.planner = planner;
  }

  plan(diagram: Diagram): WasmProgram {
    return this.planner.plan(diagram);
  }

  emitText(diagram: Diagram, options?: CompileOptionsLike): string {
    return this.profile.emitText(this.plan(diagram), options);
  }

  /** Compile through the runtime wasm profile (browser via Binaryen; MCU unimplemented). */
  compile(diagram: Diagram, options?: CompileOptionsLike): Uint8Array {
    return this.profile.compile(this.plan(diagram), options);
  }

  /** Compile with the runtime, then instantiate the module on the given wasm runtime. */
  async run<TSession extends WasmSessionLike = WasmSessionLike>(
    diagram: Diagram,
    runtime: WasmRuntimeLike<TSession>,
    options?: CompileOptionsLike,
  ): Promise<TSession> {
    const wasm = this.compile(diagram, options);
    return runtime.instantiate(wasm);
  }
}

export class BrowserCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(browserProfile, initialFiles);
  }
}

export class McuCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(mcuProfile, initialFiles);
  }
}
