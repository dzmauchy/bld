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

export const PUSH_BLOCK_REFS = new Set([
  "scope_f32",
  "product_f32",
  "cos_f32",
  "sin_f32",
]);

export const TICK_BLOCK_REFS = new Set([
  "scope_f32",
  "const_f32",
  "cos_gen_f32",
  "sin_gen_f32",
  "rand_gen_f32",
  "pulse_gen_f32",
]);
