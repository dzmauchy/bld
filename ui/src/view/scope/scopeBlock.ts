import type { Diagram, DiagramBlock } from "core";

/** Scope blocks whose channels are drawn together on one plot. */
export class ScopeBlock {
  static isScope(block: DiagramBlock): boolean {
    return block.ref.startsWith("Scope");
  }

  static precisionKind(block: DiagramBlock): "f32" | "f64" {
    if (block.ref.endsWith("F64") || block.definition.namespace.includes("f_64")) return "f64";
    return "f32";
  }

  static domainSeconds(block: DiagramBlock): number {
    return ScopeBlock.positive(block.getConf("period"), 60);
  }

  static sampleMilliseconds(block: DiagramBlock): number {
    return ScopeBlock.positive(block.getConf("precision"), 10);
  }

  /** One series per scope output channel, labeled by the block that feeds it. */
  static channels(diagram: Diagram, block: DiagramBlock): { channel: number; label: string }[] {
    const rows: { channel: number; label: string }[] = [];
    for (const connection of diagram.getConnectionsForBlock(block.id)) {
      if (connection.from.blockId !== block.id || connection.from.portId !== "channels") continue;
      const source = diagram.getBlock(connection.to.blockId);
      rows.push({ channel: connection.from.vectorIndex, label: source?.definition.title ?? connection.to.blockId });
    }
    rows.sort((left, right) => left.channel - right.channel);
    const titles = rows.map((row) => row.label);
    return rows.map((row) => ({
      channel: row.channel,
      label: titles.filter((title) => title === row.label).length > 1 ? `${row.label} ${row.channel}` : row.label,
    }));
  }

  private static positive(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
