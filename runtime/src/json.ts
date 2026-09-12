/** Diagram JSON matching `diagram.schema.json`. */
export interface DiagramPortJson {
  type: "input" | "output";
  id: string;
  vector_index?: number;
}

export interface DiagramEndpointJson {
  block: string;
  port: DiagramPortJson;
}

export interface DiagramBlockJson {
  ref: string;
  x: number;
  y: number;
  conf?: Record<string, unknown>;
}

export interface DiagramConnectionJson {
  from: DiagramEndpointJson;
  to: DiagramEndpointJson;
}

export interface DiagramJson {
  $schema?: string;
  id: string;
  title: string;
  blocks: Record<string, DiagramBlockJson>;
  connections: Record<string, DiagramConnectionJson>;
}

/** Library manifest matching `library.schema.json`. */
export interface PackageManifest {
  $schema?: string;
  id: string;
  name: string;
  icon?: string;
  types?: string[];
  namespaces?: string[];
  blocks?: string[];
  assembly?: string;
}

export type WasmProfileName = "browser" | "mcu";
