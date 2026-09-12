/**
 * @title Diagram Compiler
 */
import type { Diagram } from "./diagram";
import type { Connection } from "./connection";
import type { DiagramBlock } from "./diagramBlock";
import {
  browserProfile,
  getWasmProfile,
  mcuProfile,
  PUSH_BLOCK_REFS,
  WasmProfile,
  type CompileOptions,
  type DownstreamRef,
  type PlannedBlock,
  type WasmProgram,
  type WasmProfileName,
} from "../wasm/compile";

export { browserProfile, mcuProfile, WasmProfile, getWasmProfile };
export type { CompileOptions, PlannedBlock, WasmProgram, WasmProfileName, DownstreamRef };
export {
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

function numericIds(blocks: readonly DiagramBlock[]): Map<string, number> {
  const map = new Map<string, number>();
  blocks.forEach((block, index) => map.set(block.id, index));
  return map;
}

function maxVectorIndex(
  connections: readonly Connection[],
  blockId: string,
  portId?: string,
  fallback = 0,
): number {
  let maxVec = fallback;
  for (const connection of connections) {
    if (!connection.connectsBlock(blockId)) continue;
    const endpoint = connection.from.blockId === blockId ? connection.from : connection.to;
    if (portId !== undefined && endpoint.portId !== portId) continue;
    if (endpoint.vectorIndex > maxVec) maxVec = endpoint.vectorIndex;
  }
  return maxVec;
}

function otherEndpoint(connection: Connection, blockId: string) {
  if (connection.from.blockId === blockId) return connection.to;
  if (connection.to.blockId === blockId) return connection.from;
  return undefined;
}

export function planDiagram(diagram: Diagram): WasmProgram {
  const blocks = diagram.getBlocks();
  const connections = diagram.getConnections();
  const ids = numericIds(blocks);
  const planned: PlannedBlock[] = [];

  for (const block of blocks) {
    const id = ids.get(block.id) ?? 0;
    const consumers: DownstreamRef[] = [];
    const pinConsumers: DownstreamRef[][] = [];

    for (const connection of connections) {
      const other = otherEndpoint(connection, block.id);
      if (!other) continue;
      const otherBlock = diagram.getBlock(other.blockId);
      if (!otherBlock || !PUSH_BLOCK_REFS.has(otherBlock.ref)) continue;
      const otherId = ids.get(other.blockId);
      if (otherId === undefined) continue;
      const dest = { blockId: otherId, channel: other.vectorIndex };
      consumers.push(dest);
      if (block.ref === "gpio_in") {
        const self = connection.from.blockId === block.id ? connection.from : connection.to;
        const pinIndex = self.vectorIndex;
        while (pinConsumers.length <= pinIndex) pinConsumers.push([]);
        pinConsumers[pinIndex].push(dest);
      }
    }

    let receiveChannels = 1;
    if (block.ref === "scope_f32") {
      receiveChannels = maxVectorIndex(connections, block.id, undefined, 0) + 1;
    } else if (block.ref === "product_f32") {
      receiveChannels = maxVectorIndex(connections, block.id, "v", 1) + 1;
    }

    const plannedBlock: PlannedBlock = {
      id,
      ref: block.ref,
      conf: block.getAllConf(),
      consumers,
      receiveChannels,
    };
    if (block.ref === "gpio_in") {
      plannedBlock.pinConsumers = pinConsumers.length > 0 ? pinConsumers : [consumers];
    }
    planned.push(plannedBlock);
  }

  return { blocks: planned };
}

export class DiagramCompiler extends CompilationModel {
  constructor(
    profileOrOptions?: WasmProfile | string | CompilerOptions | Record<string, string>,
    initialFiles?: Record<string, string>,
  ) {
    super(profileOrOptions, initialFiles);
  }

  plan(diagram: Diagram): WasmProgram {
    return planDiagram(diagram);
  }

  emitText(diagram: Diagram, options?: CompileOptionsLike): string {
    return this.profile.emitText(this.plan(diagram), options);
  }

  compile(diagram: Diagram, options?: CompileOptionsLike): Uint8Array {
    return this.profile.compile(this.plan(diagram), options);
  }

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
