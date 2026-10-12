import type { Diagram } from "core";

/** Detects unwired ports before starting an interactive diagram run. */
export class DiagramConnectionValidator {
  validate(diagram: Diagram): void {
    const blocks = diagram.getBlocks();
    if (blocks.length === 0) throw new Error("Add and connect blocks before running the diagram.");
    const connected = new Set<string>();
    for (const connection of diagram.getConnections()) {
      for (const endpoint of [connection.from, connection.to]) {
        connected.add(this.key(endpoint.blockId, endpoint.portType, endpoint.portId));
      }
    }
    const missing: string[] = [];
    for (const block of blocks) {
      for (const port of [...block.getInputPorts(), ...block.getOutputPorts()]) {
        if (connected.has(this.key(block.id, port.direction, port.id))) continue;
        // A port explicitly configured with zero channels needs no wiring.
        const length = port.lengthBindConfId ? block.getConf(port.lengthBindConfId) : undefined;
        if (port.vector && (length === 0 || (Array.isArray(length) && length.length === 0))) continue;
        missing.push(`${block.definition.title}: port “${port.id}” has no connection.`);
      }
    }
    if (missing.length) throw new Error(`Connect these ports before running:\n${missing.join("\n")}`);
  }

  private key(blockId: string, direction: string, portId: string): string {
    return `${blockId}\0${direction}\0${portId}`;
  }
}
