import browserHost from "core/model/browserHost.ts?raw";
import appAssets from "core/model/appAssets.ts?raw";
import blockDefinition from "core/model/blockDefinition.ts?raw";
import clangFunctionCatalog from "core/model/clangFunctionCatalog.ts?raw";
import compiler from "core/model/compiler.ts?raw";
import compilerContext from "core/model/compilerContext.ts?raw";
import connection from "core/model/connection.ts?raw";
import cppBlockCatalog from "core/model/cppBlockCatalog.ts?raw";
import cppBuilder from "core/model/cppBuilder.ts?raw";
import cppFactoryAdapter from "core/model/cppFactoryAdapter.ts?raw";
import diagram from "core/model/diagram.ts?raw";
import diagramBlock from "core/model/diagramBlock.ts?raw";
import endpoint from "core/model/endpoint.ts?raw";
import metadataCatalog from "core/model/metadataCatalog.ts?raw";
import index from "core/model/index.ts?raw";
import inferredPortType from "core/model/inferredPortType.ts?raw";
import library from "core/model/library.ts?raw";
import libraryArchive from "core/model/libraryArchive.ts?raw";
import palette from "core/model/palette.ts?raw";
import { modelAssetFiles } from "core";

export const modelAssets = {
  "appAssets.ts": appAssets,
  "browserHost.ts": browserHost,
  "blockDefinition.ts": blockDefinition,
  "clangFunctionCatalog.ts": clangFunctionCatalog,
  "compiler.ts": compiler,
  "compilerContext.ts": compilerContext,
  "connection.ts": connection,
  "cppBlockCatalog.ts": cppBlockCatalog,
  "cppBuilder.ts": cppBuilder,
  "cppFactoryAdapter.ts": cppFactoryAdapter,
  "diagram.ts": diagram,
  "diagramBlock.ts": diagramBlock,
  "endpoint.ts": endpoint,
  "metadataCatalog.ts": metadataCatalog,
  "index.ts": index,
  "inferredPortType.ts": inferredPortType,
  "library.ts": library,
  "libraryArchive.ts": libraryArchive,
  "palette.ts": palette,
} satisfies Record<(typeof modelAssetFiles)[number], string>;
