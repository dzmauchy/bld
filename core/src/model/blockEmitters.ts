/**
 * @title Block Emitters
 */
import { defaultRegistry, type BlockRegistry } from "runtime";

/**
 * Contract for querying available block emitter implementations.
 * The core domain is agnostic about what execution type a block belongs to.
 */
export interface IBlockRegistryView {
  has(ref: string): boolean;
}

/**
 * Agnostic view of available block emitters in a registry.
 */
export class BlockEmitterRegistryView implements IBlockRegistryView {
  constructor(private readonly registry: BlockRegistry = defaultRegistry) {}

  has(ref: string): boolean {
    return this.registry.has(ref);
  }
}

export const defaultBlockEmitters = new BlockEmitterRegistryView(defaultRegistry);
