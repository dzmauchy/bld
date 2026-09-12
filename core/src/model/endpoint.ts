/**
 * @title Port Endpoint
 */
export interface RawPortJson {
  type: "input" | "output";
  id: string;
  vector_index?: number;
}

export interface RawEndpointJson {
  block: string;
  port: RawPortJson;
}

export class PortEndpoint {
  readonly vectorIndex: number;

  constructor(
    readonly blockId: string,
    readonly portType: "input" | "output",
    readonly portId: string,
    vectorIndex = 0,
  ) {
    this.vectorIndex = vectorIndex;
  }

  toString(): string {
    return `${this.blockId}.${this.portType}.${this.portId}[${this.vectorIndex}]`;
  }

  equals(other: PortEndpoint): boolean {
    return (
      this.blockId === other.blockId &&
      this.portType === other.portType &&
      this.portId === other.portId &&
      this.vectorIndex === other.vectorIndex
    );
  }

  toJSON(): RawEndpointJson {
    return {
      block: this.blockId,
      port: {
        type: this.portType,
        id: this.portId,
        vector_index: this.vectorIndex,
      },
    };
  }

  static fromJSON(json: RawEndpointJson): PortEndpoint {
    return new PortEndpoint(
      json.block,
      json.port.type,
      json.port.id,
      json.port.vector_index ?? 0,
    );
  }
}
