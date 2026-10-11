import type { Connection, DiagramBlock } from "core";
import type { WireRoute } from "./wireRoute.js";

export type WireRouteListener = (route: WireRoute) => void;

export abstract class WireRouter {
  abstract start(): void;
  abstract upsertBlock(block: DiagramBlock): void;
  abstract addLink(connection: Connection): void;
  abstract removeLink(connectionId: string): void;
  abstract removeBlock(blockId: string): void;
  abstract destroy(): void;
}
