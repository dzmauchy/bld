import { defaultRegistry } from "./registry";

/** Live view of push-capable blocks registered with the default runtime registry. */
export const PUSH_BLOCK_REFS = {
  has(ref: string): boolean {
    return defaultRegistry.isPush(ref);
  },
};

/** Live view of tick-emitting blocks registered with the default runtime registry. */
export const TICK_BLOCK_REFS = {
  has(ref: string): boolean {
    return defaultRegistry.get(ref)?.tick === true;
  },
};
