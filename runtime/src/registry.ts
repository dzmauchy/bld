import type { BlockEmitter, Expr, PushEmitter, TickEmitter } from "./dsl";

export type BlockSpec = {
  emit: (block: BlockEmitter) => void;
};

export class BlockRegistry {
  private readonly blocks = new Map<string, BlockSpec>();

  define(ref: string, specOrEmit: BlockSpec | ((block: BlockEmitter) => void)): void {
    if (typeof specOrEmit === "function") {
      this.blocks.set(ref, { emit: specOrEmit });
    } else {
      this.blocks.set(ref, specOrEmit);
    }
  }

  get(ref: string): BlockSpec | undefined {
    return this.blocks.get(ref);
  }

  has(ref: string): boolean {
    return this.blocks.has(ref);
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

  define(ref: string, specOrEmit: BlockSpec | ((block: BlockEmitter) => void)): void {
    this.registry.define(ref, specOrEmit);
  }

  definePush(ref: string, emit: (block: BlockEmitter) => void): void {
    this.define(ref, emit);
  }

  definePeriodic(ref: string, emit: (block: BlockEmitter) => void): void {
    this.define(ref, emit);
  }

  defineUnary(ref: string, fn: (push: PushEmitter, val: Expr) => Expr): void {
    this.define(ref, (b) => b.onUnaryPush(fn));
  }

  defineGenerator(ref: string, fn: (tick: TickEmitter, block: BlockEmitter) => Expr, defaultInterval = 10): void {
    this.define(ref, (b) => b.forwardOnTick((t) => fn(t, b), defaultInterval));
  }
}

export function installLibrary(install: (api: LibraryApi) => void, registry: BlockRegistry = defaultRegistry): BlockRegistry {
  install(new LibraryApi(registry));
  return registry;
}
