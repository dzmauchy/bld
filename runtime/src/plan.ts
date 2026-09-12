import type { DiagramJson } from "./json";
import type { DownstreamRef, PlannedBlock, WasmProgram } from "./program";
import type { BlockRegistry } from "./registry";

export type PlanEndpoint = {
  blockId: string;
  portId: string;
  vectorIndex: number;
};

export type PlanConnection = {
  from: PlanEndpoint;
  to: PlanEndpoint;
};

export type PlanBlock = {
  id: string;
  ref: string;
  conf: Record<string, unknown>;
};

export type PlanInput = {
  blocks: PlanBlock[];
  connections: PlanConnection[];
};

export abstract class AbstractProgramPlanner {
  abstract plan(input: PlanInput): WasmProgram;
  abstract planDiagramJson(diagram: DiagramJson): WasmProgram;
}

export class WasmProgramPlanner extends AbstractProgramPlanner {
  constructor(protected readonly registry: BlockRegistry) {
    super();
  }

  private numericIds(blockIds: readonly string[]): Map<string, number> {
    const map = new Map<string, number>();
    blockIds.forEach((id, index) => map.set(id, index));
    return map;
  }

  private otherEndpoint(connection: PlanConnection, blockId: string): PlanEndpoint | undefined {
    if (connection.from.blockId === blockId) return connection.to;
    if (connection.to.blockId === blockId) return connection.from;
    return undefined;
  }

  private maxVectorIndex(
    connections: PlanConnection[],
    blockId: string,
    portId: string | undefined,
    fallback: number,
  ): number {
    let maxVec = fallback;
    for (const connection of connections) {
      const endpoint =
        connection.from.blockId === blockId
          ? connection.from
          : connection.to.blockId === blockId
            ? connection.to
            : undefined;
      if (!endpoint) continue;
      if (portId !== undefined && endpoint.portId !== portId) continue;
      if (endpoint.vectorIndex > maxVec) maxVec = endpoint.vectorIndex;
    }
    return maxVec;
  }

  private planBlock(
    block: PlanBlock,
    id: number,
    input: PlanInput,
    ids: Map<string, number>,
    byId: Map<string, PlanBlock>,
  ): PlannedBlock {
    const consumers: DownstreamRef[] = [];
    const pinConsumers: DownstreamRef[][] = [];

    for (const connection of input.connections) {
      const other = this.otherEndpoint(connection, block.id);
      if (!other) continue;
      const otherBlock = byId.get(other.blockId);
      if (!otherBlock || !this.registry.isPush(otherBlock.ref)) continue;
      const otherId = ids.get(other.blockId);
      if (otherId === undefined) continue;
      const dest = { blockId: otherId, channel: other.vectorIndex };
      consumers.push(dest);
      if (block.ref === "gpio_in") {
        const self = connection.from.blockId === block.id ? connection.from : connection.to;
        const pinIndex = self.vectorIndex;
        while (pinConsumers.length <= pinIndex) pinConsumers.push([]);
        pinConsumers[pinIndex].push(dest);
      }
    }

    const channelMode = this.registry.channels(block.ref);
    const fallback = channelMode === "product" ? 1 : 0;
    const portId = channelMode === "product" ? "v" : undefined;
    const receiveChannels = this.maxVectorIndex(input.connections, block.id, portId, fallback) + 1;

    const plannedBlock: PlannedBlock = {
      id,
      ref: block.ref,
      conf: block.conf,
      consumers,
      receiveChannels,
    };
    if (block.ref === "gpio_in") {
      plannedBlock.pinConsumers = pinConsumers.length > 0 ? pinConsumers : [consumers];
    }
    return plannedBlock;
  }

  override plan(input: PlanInput): WasmProgram {
    const ids = this.numericIds(input.blocks.map((block) => block.id));
    const byId = new Map(input.blocks.map((block) => [block.id, block]));
    const planned: PlannedBlock[] = [];

    for (const block of input.blocks) {
      const id = ids.get(block.id) ?? 0;
      planned.push(this.planBlock(block, id, input, ids, byId));
    }

    return { blocks: planned };
  }

  override planDiagramJson(diagram: DiagramJson): WasmProgram {
    const blocks: PlanBlock[] = Object.entries(diagram.blocks ?? {}).map(([id, block]) => ({
      id,
      ref: block.ref,
      conf: block.conf ?? {},
    }));
    const connections: PlanConnection[] = Object.values(diagram.connections ?? {}).map((connection) => ({
      from: {
        blockId: connection.from.block,
        portId: connection.from.port.id,
        vectorIndex: connection.from.port.vector_index ?? 0,
      },
      to: {
        blockId: connection.to.block,
        portId: connection.to.port.id,
        vectorIndex: connection.to.port.vector_index ?? 0,
      },
    }));
    return this.plan({ blocks, connections });
  }
}

export function planProgram(input: PlanInput, registry: BlockRegistry): WasmProgram {
  return new WasmProgramPlanner(registry).plan(input);
}

export function planDiagramJson(diagram: DiagramJson, registry: BlockRegistry): WasmProgram {
  return new WasmProgramPlanner(registry).planDiagramJson(diagram);
}
