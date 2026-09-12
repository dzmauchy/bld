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

export abstract class Endpoint {
  constructor(readonly blockId: string) {}

  abstract toString(): string;
  abstract equals(other: Endpoint): boolean;
  abstract toJSON(): unknown;
}

export class PortEndpoint extends Endpoint {
  readonly vectorIndex: number;

  constructor(
    blockId: string,
    readonly portType: "input" | "output",
    readonly portId: string,
    vectorIndex = 0,
  ) {
    super(blockId);
    this.vectorIndex = vectorIndex;
  }

  get isInput(): boolean {
    return this.portType === "input";
  }

  get isOutput(): boolean {
    return this.portType === "output";
  }

  override toString(): string {
    return `${this.blockId}.${this.portType}.${this.portId}[${this.vectorIndex}]`;
  }

  override equals(other: Endpoint): boolean {
    return (
      other instanceof PortEndpoint &&
      this.blockId === other.blockId &&
      this.portType === other.portType &&
      this.portId === other.portId &&
      this.vectorIndex === other.vectorIndex
    );
  }

  override toJSON(): RawEndpointJson {
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
    if (json.port.type === "input") {
      return new InputPortEndpoint(json.block, json.port.id, json.port.vector_index ?? 0);
    }
    return new OutputPortEndpoint(json.block, json.port.id, json.port.vector_index ?? 0);
  }
}

export class InputPortEndpoint extends PortEndpoint {
  constructor(blockId: string, portId: string, vectorIndex = 0) {
    super(blockId, "input", portId, vectorIndex);
  }
}

export class OutputPortEndpoint extends PortEndpoint {
  constructor(blockId: string, portId: string, vectorIndex = 0) {
    super(blockId, "output", portId, vectorIndex);
  }
}
