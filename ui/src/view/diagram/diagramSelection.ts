/** Immutable selection of blocks and connections on one diagram. */
export class DiagramSelection {
  private constructor(
    private readonly blockIds: ReadonlySet<string> = new Set(),
    private readonly connectionIds: ReadonlySet<string> = new Set(),
  ) {}

  static empty(): DiagramSelection {
    return new DiagramSelection();
  }

  get size(): number {
    return this.blockIds.size + this.connectionIds.size;
  }

  hasBlock(id: string): boolean {
    return this.blockIds.has(id);
  }

  hasConnection(id: string): boolean {
    return this.connectionIds.has(id);
  }

  blocks(): readonly string[] {
    return [...this.blockIds];
  }

  connections(): readonly string[] {
    return [...this.connectionIds];
  }

  selectBlock(id: string, additive = false): DiagramSelection {
    const blocks = additive ? new Set(this.blockIds) : new Set<string>();
    if (additive && blocks.has(id)) blocks.delete(id);
    else blocks.add(id);
    return new DiagramSelection(blocks, additive ? this.connectionIds : new Set());
  }

  selectConnection(id: string, additive = false): DiagramSelection {
    const connections = additive ? new Set(this.connectionIds) : new Set<string>();
    if (additive && connections.has(id)) connections.delete(id);
    else connections.add(id);
    return new DiagramSelection(additive ? this.blockIds : new Set(), connections);
  }
}
