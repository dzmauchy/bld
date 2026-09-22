import appAssets from "core/model/appAssets.ts?raw";
import blockDefinition from "core/model/blockDefinition.ts?raw";
import clangAst from "core/model/clangAst.ts?raw";
import clangAstDumper from "core/model/clangAstDumper.ts?raw";
import compiler from "core/model/compiler.ts?raw";
import compilerContext from "core/model/compilerContext.ts?raw";
import connection from "core/model/connection.ts?raw";
import cppBlockCatalog from "core/model/cppBlockCatalog.ts?raw";
import cppBuilder from "core/model/cppBuilder.ts?raw";
import diagram from "core/model/diagram.ts?raw";
import diagramBlock from "core/model/diagramBlock.ts?raw";
import endpoint from "core/model/endpoint.ts?raw";
import headerCatalog from "core/model/headerCatalog.ts?raw";
import hostClangAstDumper from "core/model/hostClangAstDumper.ts?raw";
import index from "core/model/index.ts?raw";
import library from "core/model/library.ts?raw";
import palette from "core/model/palette.ts?raw";
import { modelAssetFiles } from "core";

export const modelAssets = {
  "appAssets.ts": appAssets,
  "blockDefinition.ts": blockDefinition,
  "clangAst.ts": clangAst,
  "clangAstDumper.ts": clangAstDumper,
  "compiler.ts": compiler,
  "compilerContext.ts": compilerContext,
  "connection.ts": connection,
  "cppBlockCatalog.ts": cppBlockCatalog,
  "cppBuilder.ts": cppBuilder,
  "diagram.ts": diagram,
  "diagramBlock.ts": diagramBlock,
  "endpoint.ts": endpoint,
  "headerCatalog.ts": headerCatalog,
  "hostClangAstDumper.ts": hostClangAstDumper,
  "index.ts": index,
  "library.ts": library,
  "palette.ts": palette,
} satisfies Record<(typeof modelAssetFiles)[number], string>;
