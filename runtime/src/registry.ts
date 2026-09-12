import type { BlockEmitter } from "./dsl";

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
}

export function installLibrary(install: (api: LibraryApi) => void, registry: BlockRegistry = defaultRegistry): BlockRegistry {
  install(new LibraryApi(registry));
  return registry;
}
