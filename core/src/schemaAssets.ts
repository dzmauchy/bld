export abstract class SchemaCatalog {
  abstract readonly schemaNames: readonly string[];
  abstract readonly publicDirectory: string;

  schemaFileName(name: string): string {
    return `${name}.schema.json`;
  }

  publishedPath(name: string): string {
    return `${this.publicDirectory}/${this.schemaFileName(name)}`;
  }

  publishedFiles(): string[] {
    return this.schemaNames.map((name) => this.schemaFileName(name));
  }
}

export class CoreSchemaCatalog extends SchemaCatalog {
  static readonly shared = new CoreSchemaCatalog();

  readonly schemaNames = ["blocks", "diagram", "library", "namespaces", "types"] as const;
  readonly publicDirectory = "schemas";

  get diagramSchemaPath(): string {
    return this.publishedPath("diagram");
  }
}

export const coreSchemaCatalog = CoreSchemaCatalog.shared;
export const schemaAssetFiles = CoreSchemaCatalog.shared.publishedFiles();
export const diagramSchemaPath = CoreSchemaCatalog.shared.diagramSchemaPath;
