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
  constructor(protected readonly registry?: BlockRegistry) {
    super();
  }

  private numericIds(blockIds: readonly string[]): Map<string, number> {
    return new Map(blockIds.map((id, index) => [id, index]));
  }

  private maxVectorIndex(
    connections: PlanConnection[],
    blockId: string,
    fallback: number,
  ): number {
    return connections.reduce((max, c) => {
      const ep = c.to.blockId === blockId ? c.to : undefined;
      return ep ? Math.max(max, ep.vectorIndex) : max;
    }, fallback);
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
      if (connection.from.blockId !== block.id) continue;
      const target = connection.to;
      const targetBlock = byId.get(target.blockId);
      if (!targetBlock) continue;
      const targetId = ids.get(target.blockId);
      if (targetId === undefined) continue;
      const dest = { blockId: targetId, channel: target.vectorIndex };
      consumers.push(dest);

      const pinIndex = connection.from.vectorIndex;
      while (pinConsumers.length <= pinIndex) pinConsumers.push([]);
      pinConsumers[pinIndex].push(dest);
    }

    const receiveChannels = Math.max(1, this.maxVectorIndex(input.connections, block.id, -1) + 1);

    const plannedBlock: PlannedBlock = {
      id,
      ref: block.ref,
      conf: block.conf,
      consumers,
      receiveChannels,
    };
    if (pinConsumers.length > 0) {
      plannedBlock.pinConsumers = pinConsumers;
    }
    return plannedBlock;
  }

  override plan(input: PlanInput): WasmProgram {
    const ids = this.numericIds(input.blocks.map((block) => block.id));
    const byId = new Map(input.blocks.map((block) => [block.id, block]));
    return { blocks: input.blocks.map((b) => this.planBlock(b, ids.get(b.id) ?? 0, input, ids, byId)) };
  }

  override planDiagramJson(diagram: DiagramJson): WasmProgram {
    const toEndpoint = (ep: { block: string; port: { id: string; vector_index?: number } }): PlanEndpoint => ({
      blockId: ep.block,
      portId: ep.port.id,
      vectorIndex: ep.port.vector_index ?? 0,
    });
    const blocks: PlanBlock[] = Object.entries(diagram.blocks ?? {}).map(([id, b]) => ({
      id,
      ref: b.ref,
      conf: b.conf ?? {},
    }));
    const connections: PlanConnection[] = Object.values(diagram.connections ?? {}).map((c) => ({
      from: toEndpoint(c.from),
      to: toEndpoint(c.to),
    }));
    return this.plan({ blocks, connections });
  }
}

export const planProgram = (input: PlanInput, registry?: BlockRegistry): WasmProgram =>
  new WasmProgramPlanner(registry).plan(input);

export const planDiagramJson = (diagram: DiagramJson, registry?: BlockRegistry): WasmProgram =>
  new WasmProgramPlanner(registry).planDiagramJson(diagram);
