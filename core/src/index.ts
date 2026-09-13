export function add(left: number, right: number): number {
  return left + right;
}

export * from "./types/index";
export * from "./model/index";
export { modelAssetFiles } from "./modelAssets";
export {
  CoreSchemaCatalog,
  SchemaCatalog,
  coreSchemaCatalog,
  diagramSchemaPath,
  schemaAssetFiles,
} from "./schemaAssets";

