import type { BlockEmitter, Expr, PushEmitter, TickEmitter } from "./dsl";

export type BlockSpec = {
  /**
   * When true, other blocks may push values into this block's `onPush` handler.
   * Used while planning diagram connections.
   */
  push?: boolean;
  /** When true, the block emits a periodic tick function. */
  tick?: boolean;
  /**
   * Lower numbers are emitted first so callees exist before callers.
   * Default: 1 for push blocks, 2 otherwise.
   */
  priority?: number;
  /**
   * Incoming vector width. `"product"` keeps a spare factor slot (default 1).
   */
  channels?: "auto" | "product";
  emit: (block: BlockEmitter) => void;
};

export class BlockRegistry {
  private readonly blocks = new Map<string, BlockSpec>();

  define(ref: string, spec: BlockSpec): void {
    this.blocks.set(ref, spec);
  }

  get(ref: string): BlockSpec | undefined {
    return this.blocks.get(ref);
  }

  has(ref: string): boolean {
    return this.blocks.has(ref);
  }

  isPush(ref: string): boolean {
    return this.blocks.get(ref)?.push === true;
  }

  channels(ref: string): "auto" | "product" {
    return this.blocks.get(ref)?.channels ?? "auto";
  }

  priority(ref: string): number {
    const spec = this.blocks.get(ref);
    if (spec?.priority !== undefined) return spec.priority;
    return spec?.push ? 1 : 2;
  }

  refs(): string[] {
    return [...this.blocks.keys()];
  }

  require(ref: string): BlockSpec {
    const spec = this.blocks.get(ref);
    if (!spec) {
      throw new Error(`Unknown block type "${ref}"`);
    }
    return spec;
  }
}

export const defaultRegistry = new BlockRegistry();

/** Library assembly entry. Bundled JS should export `install(api)`. */
export class LibraryApi {
  constructor(private readonly registry: BlockRegistry) {}

  define(ref: string, spec: BlockSpec): void {
    this.registry.define(ref, spec);
  }

  definePush(ref: string, emit: (block: BlockEmitter) => void, priority = 1, channels?: "auto" | "product"): void {
    const spec: BlockSpec = { push: true, priority, emit };
    if (channels !== undefined) spec.channels = channels;
    this.define(ref, spec);
  }

  definePeriodic(ref: string, emit: (block: BlockEmitter) => void): void {
    this.define(ref, { tick: true, emit });
  }

  defineUnary(ref: string, fn: (push: PushEmitter, val: Expr) => Expr, priority = 1): void {
    this.definePush(ref, (b) => b.onUnaryPush(fn), priority);
  }

  defineGenerator(ref: string, fn: (tick: TickEmitter, block: BlockEmitter) => Expr, defaultInterval = 10): void {
    this.definePeriodic(ref, (b) => b.forwardOnTick((t) => fn(t, b), defaultInterval));
  }
}

export function installLibrary(install: (api: LibraryApi) => void, registry: BlockRegistry = defaultRegistry): BlockRegistry {
  install(new LibraryApi(registry));
  return registry;
}
