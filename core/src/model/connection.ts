/**
 * @title Connection
 */
import { PortEndpoint, type RawEndpointJson } from "./endpoint";

export interface RawConnectionJson {
  from: RawEndpointJson;
  to: RawEndpointJson;
}

export class Connection {
  constructor(
    readonly id: string,
    readonly from: PortEndpoint,
    readonly to: PortEndpoint,
  ) {}

  connectsBlock(blockId: string): boolean {
    return this.from.blockId === blockId || this.to.blockId === blockId;
  }

  connectsEndpoint(endpoint: PortEndpoint): boolean {
    return this.from.equals(endpoint) || this.to.equals(endpoint);
  }

  toJSON(): RawConnectionJson {
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
