import { BlockRegistry, defaultRegistry } from "./registry";

export interface IBlockPredicate {
  has(ref: string): boolean;
}

export class RegistryBlockPredicateView implements IBlockPredicate {
  constructor(private readonly registry: BlockRegistry = defaultRegistry) {}

  has(ref: string): boolean {
    return this.registry.has(ref);
  }
}

/** Live view of push-capable blocks registered with the default runtime registry. */
export const PUSH_BLOCK_REFS = new RegistryBlockPredicateView();

/** Live view of tick-emitting blocks registered with the default runtime registry. */
export const TICK_BLOCK_REFS = new RegistryBlockPredicateView();
