/**
 * Serializable IR for Binaryen wasm generation.
 * Each diagram block becomes one or more wasm functions.
 */
export type DownstreamRef = {
  blockId: number;
  channel: number;
};

export type PlannedBlock = {
  id: number;
  ref: string;
  conf: Record<string, unknown>;
  /** Push destinations (sinks and transformers) this block writes to. */
  consumers: DownstreamRef[];
  /** gpio_in: consumers grouped by pin index. */
  pinConsumers?: DownstreamRef[][];
  /** Incoming vector width (scope channels, product factors). */
  receiveChannels: number;
};

export type WasmProgram = {
  blocks: PlannedBlock[];
};

export type CompileOptions = {
  debug?: boolean;
  optimizeLevel?: number;
};
