/**
 * @title Connection
 */
import { DiagramElement } from "./diagramBlock";
import { PortEndpoint, type RawEndpointJson } from "./endpoint";

export interface RawConnectionJson {
  from: RawEndpointJson;
  to: RawEndpointJson;
}

export class Connection extends DiagramElement {
  constructor(
    id: string,
    readonly from: PortEndpoint,
    readonly to: PortEndpoint,
  ) {
    super(id);
  }

  connectsBlock(blockId: string): boolean {
    return this.from.blockId === blockId || this.to.blockId === blockId;
  }

  connectsEndpoint(endpoint: PortEndpoint): boolean {
    return this.from.equals(endpoint) || this.to.equals(endpoint);
  }

  otherEndpoint(blockId: string): PortEndpoint | undefined {
    if (this.from.blockId === blockId) return this.to;
    if (this.to.blockId === blockId) return this.from;
    return undefined;
  }

  isBetween(blockA: string, blockB: string): boolean {
    return (
      (this.from.blockId === blockA && this.to.blockId === blockB) ||
      (this.from.blockId === blockB && this.to.blockId === blockA)
    );
  }

  matches(a: PortEndpoint, b: PortEndpoint): boolean {
    return (this.from.equals(a) && this.to.equals(b)) || (this.from.equals(b) && this.to.equals(a));
  }

  override toJSON(): RawConnectionJson {
    return {
      from: this.from.toJSON(),
      to: this.to.toJSON(),
    };
  }

  static fromJSON(id: string, json: RawConnectionJson): Connection {
    return new Connection(
      id,
      PortEndpoint.fromJSON(json.from),
      PortEndpoint.fromJSON(json.to),
    );
  }
}
