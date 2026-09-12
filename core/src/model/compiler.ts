/**
 * @title Diagram Compiler
 */
import type { Diagram } from "./diagram";
import {
  BlockEmitterRegistry,
  CodegenSession,
  defaultBlockEmitters,
} from "./blockEmitters";
import {
  browserContext,
  CompilerContext,
  CompilerContextRegistry,
  mcuContext,
} from "./compilerContext";

export {
  browserContext,
  BrowserCompilerContext,
  COMMON_PRELUDE_IMPORTS,
  CompilerContext,
  CompilerContextRegistry,
  getCompilerContext,
  HostCompilerContext,
  mcuContext,
  McuCompilerContext,
  registerCompilerContext,
} from "./compilerContext";
export {
  BlockEmitter,
  BlockEmitterRegistry,
  CodegenSession,
  defaultBlockEmitters,
} from "./blockEmitters";

export interface ASSessionLike {
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

export interface ASRuntimeLike<TSession extends ASSessionLike = ASSessionLike> {
  compileSource(
    source: string,
    files?: Record<string, string>,
    options?: CompileOptionsLike,
  ): Promise<Uint8Array>;
  instantiate(wasm: Uint8Array): Promise<TSession>;
  createSession(
    source: string,
    files?: Record<string, string>,
    options?: CompileOptionsLike,
  ): Promise<TSession>;
}

export interface CompilerOptions {
  context?: CompilerContext | string;
  files?: Record<string, string>;
}

export class CompilationModel {
  protected context: CompilerContext;
  private files = new Map<string, string>();

  constructor(
    contextOrOptions?: CompilerContext | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    const parsed = CompilationModel.parseConstructorArgs(contextOrOptions);
    this.context = parsed.context;
    if (parsed.files) this.addFiles(parsed.files);
    if (initialFiles) this.addFiles(initialFiles);
  }

  private static parseConstructorArgs(
    contextOrOptions?: CompilerContext | string | CompilerOptions | Record<string, string>,
  ): { context: CompilerContext; files?: Record<string, string> } {
    if (typeof contextOrOptions === "string") {
      return { context: CompilerContextRegistry.shared.resolve(contextOrOptions) };
    }
    if (CompilerContext.isContextLike(contextOrOptions)) {
      return { context: CompilerContext.from(contextOrOptions) };
    }
    if (
      contextOrOptions &&
      typeof contextOrOptions === "object" &&
      ("context" in contextOrOptions || "files" in contextOrOptions)
    ) {
      const opts = contextOrOptions as CompilerOptions;
      const context = opts.context
        ? CompilerContextRegistry.shared.resolve(opts.context)
        : browserContext;
      if (opts.files) {
        return { context, files: opts.files };
      }
      return { context };
    }
    if (contextOrOptions && typeof contextOrOptions === "object") {
      return { context: browserContext, files: contextOrOptions as Record<string, string> };
    }
    return { context: browserContext };
  }

  getContext(): CompilerContext {
    return this.context;
  }

  setContext(contextOrName: CompilerContext | string): void {
    this.context = CompilerContextRegistry.shared.resolve(contextOrName);
  }

  addFile(name: string, content: string): void {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    this.files.set(clean, content);
    const slash = clean.lastIndexOf("/");
    if (slash !== -1) {
      const base = clean.slice(slash + 1);
      if (!this.files.has(base)) {
        this.files.set(base, content);
      }
    }
  }

  addFiles(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
      this.addFile(name, content);
    }
  }

  getFile(name: string): string | undefined {
    const clean = name.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.files.get(clean);
  }

  getFiles(): Record<string, string> {
    const contextFiles = this.context.getFiles();
    const result: Record<string, string> = { ...contextFiles };
    for (const [key, value] of this.files.entries()) {
      result[key] = value;
    }
    return result;
  }
}

export class DiagramCompiler extends CompilationModel {
  readonly emitters: BlockEmitterRegistry;

  constructor(
    contextOrOptions?: CompilerContext | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
    emitters: BlockEmitterRegistry = defaultBlockEmitters,
  ) {
    super(contextOrOptions, initialFiles);
    this.emitters = emitters;
  }

  generateAssemblyScript(diagram: Diagram): string {
    const blocks = diagram.getBlocks();
    const session = new CodegenSession(blocks, diagram.getConnections());

    const sinks = blocks.filter((block) => block.definition.category === "sinks");
    const transformers = blocks.filter((block) => block.definition.category === "transformers");
    const sources = blocks.filter(
      (block) =>
        block.definition.category === "sources" || (!sinks.includes(block) && !transformers.includes(block)),
    );

    for (const block of sinks) this.emitters.emit(block, session);
    for (const block of transformers) this.emitters.emit(block, session);
    for (const block of sources) this.emitters.emit(block, session);

    const prelude = this.context.getPrelude();
    const exports = this.context.getExports();
    const body = session.lines.join("\n");
    return `${prelude}\n${body}\n${exports}\n`;
  }

  async compile(
    diagram: Diagram,
    runtime: ASRuntimeLike,
    options?: CompileOptionsLike,
  ): Promise<Uint8Array> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.compileSource(source, this.getFiles(), options);
  }

  async run<TSession extends ASSessionLike = ASSessionLike>(
    diagram: Diagram,
    runtime: ASRuntimeLike<TSession>,
    options?: CompileOptionsLike,
  ): Promise<TSession> {
    const source = this.generateAssemblyScript(diagram);
    return runtime.createSession(source, this.getFiles(), options);
  }
}

export class BrowserCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(browserContext, initialFiles);
  }
}

export class McuCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(mcuContext, initialFiles);
  }
}
