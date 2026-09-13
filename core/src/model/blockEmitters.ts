/**
 * @title Block Emitters
 */
import {
  defaultRegistry,
  PUSH_BLOCK_REFS,
  TICK_BLOCK_REFS,
  RegistryBlockPredicateView,
} from "runtime";

export { PUSH_BLOCK_REFS, TICK_BLOCK_REFS, RegistryBlockPredicateView };

export const defaultBlockEmitters = new RegistryBlockPredicateView(defaultRegistry);
