/**
 * @title Port Endpoint
 */
import type { BlockDefinition, PortDefinition } from "./blockDefinition";

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
  constructor(
    blockId: string,
    readonly portType: "input" | "output",
    readonly portId: string,
    readonly vectorIndex = 0,
  ) {
    super(blockId);
  }

  get isInput(): boolean {
    return this.portType === "input";
  }

  get isOutput(): boolean {
    return this.portType === "output";
  }

  getPort(definition: BlockDefinition): PortDefinition | undefined {
    return definition.getPort(this.portId, this.portType);
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
    const Cls = json.port.type === "input" ? InputPortEndpoint : OutputPortEndpoint;
    return new Cls(json.block, json.port.id, json.port.vector_index ?? 0);
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
