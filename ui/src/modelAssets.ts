import blockDefinition from "core/model/blockDefinition.ts?raw";
import compiler from "core/model/compiler.ts?raw";
import connection from "core/model/connection.ts?raw";
import defaultCatalog from "core/model/defaultCatalog.ts?raw";
import diagram from "core/model/diagram.ts?raw";
import diagramBlock from "core/model/diagramBlock.ts?raw";
import endpoint from "core/model/endpoint.ts?raw";
import index from "core/model/index.ts?raw";
import palette from "core/model/palette.ts?raw";
import { modelAssetFiles } from "core";

export const modelAssets = {
  "blockDefinition.ts": blockDefinition,
  "compiler.ts": compiler,
  "connection.ts": connection,
  "defaultCatalog.ts": defaultCatalog,
  "diagram.ts": diagram,
  "diagramBlock.ts": diagramBlock,
  "endpoint.ts": endpoint,
  "index.ts": index,
  "palette.ts": palette,
} satisfies Record<(typeof modelAssetFiles)[number], string>;
