import appAssets from "core/model/appAssets.ts?raw";
import blockDefinition from "core/model/blockDefinition.ts?raw";
import blockEmitters from "core/model/blockEmitters.ts?raw";
import compiler from "core/model/compiler.ts?raw";
import compilerContext from "core/model/compilerContext.ts?raw";
import connection from "core/model/connection.ts?raw";
import diagram from "core/model/diagram.ts?raw";
import diagramBlock from "core/model/diagramBlock.ts?raw";
import endpoint from "core/model/endpoint.ts?raw";
import index from "core/model/index.ts?raw";
import library from "core/model/library.ts?raw";
import palette from "core/model/palette.ts?raw";
import { modelAssetFiles } from "core";

export const modelAssets = {
  "appAssets.ts": appAssets,
  "blockDefinition.ts": blockDefinition,
  "blockEmitters.ts": blockEmitters,
  "compiler.ts": compiler,
  "compilerContext.ts": compilerContext,
  "connection.ts": connection,
  "diagram.ts": diagram,
  "diagramBlock.ts": diagramBlock,
  "endpoint.ts": endpoint,
  "index.ts": index,
  "library.ts": library,
  "palette.ts": palette,
} satisfies Record<(typeof modelAssetFiles)[number], string>;
