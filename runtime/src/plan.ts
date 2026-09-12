import type { DiagramJson } from "./json";
import type { DownstreamRef, PlannedBlock, WasmProgram } from "./program";
import type { BlockRegistry } from "./registry";

function numericIds(blockIds: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  blockIds.forEach((id, index) => map.set(id, index));
  return map;
}

function maxVectorIndex(
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

function otherEndpoint(connection: PlanConnection, blockId: string): PlanEndpoint | undefined {
  if (connection.from.blockId === blockId) return connection.to;
  if (connection.to.blockId === blockId) return connection.from;
  return undefined;
}

export function planProgram(input: PlanInput, registry: BlockRegistry): WasmProgram {
  const ids = numericIds(input.blocks.map((block) => block.id));
  const byId = new Map(input.blocks.map((block) => [block.id, block]));
  const planned: PlannedBlock[] = [];

  for (const block of input.blocks) {
    const id = ids.get(block.id) ?? 0;
    const consumers: DownstreamRef[] = [];
    const pinConsumers: DownstreamRef[][] = [];

    for (const connection of input.connections) {
      const other = otherEndpoint(connection, block.id);
      if (!other) continue;
      const otherBlock = byId.get(other.blockId);
      if (!otherBlock || !registry.isPush(otherBlock.ref)) continue;
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

    const channelMode = registry.channels(block.ref);
    const fallback = channelMode === "product" ? 1 : 0;
    const portId = channelMode === "product" ? "v" : undefined;
    const receiveChannels = maxVectorIndex(input.connections, block.id, portId, fallback) + 1;

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
    planned.push(plannedBlock);
  }

  return { blocks: planned };
}

export function planDiagramJson(diagram: DiagramJson, registry: BlockRegistry): WasmProgram {
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
  return planProgram({ blocks, connections }, registry);
}
