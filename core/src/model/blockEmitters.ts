/**
 * @title Block Emitters
 */
import { defaultRegistry, PUSH_BLOCK_REFS, TICK_BLOCK_REFS } from "runtime";

export { PUSH_BLOCK_REFS, TICK_BLOCK_REFS };

export const defaultBlockEmitters = {
  has(ref: string): boolean {
    return defaultRegistry.has(ref);
  },
};
