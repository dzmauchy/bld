import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  add,
  BlockDefinition,
  CompilationModel,
  Connection,
  CoreSchemaCatalog,
  Diagram,
  DiagramBlock,
  DiagramCompiler,
  Library,
  modelAssetFiles,
  Palette,
  PortEndpoint,
  SchemaCatalog,
  TypeSystem,
  schemaAssetFiles,
} from "../../src/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const modelDir = join(coreRoot, "src/model");
const schemaDir = join(coreRoot, "assets/schemas");

function modelSourceFiles(): string[] {
  return readdirSync(modelDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

describe("core public API", () => {
  test("add remains available", () => {
    expect(add(2, 2)).toBe(4);
  });
  test("exports compiled model APIs", () => {
    expect(Diagram).toBeTypeOf("function");
    expect(Palette).toBeTypeOf("function");
    expect(DiagramBlock).toBeTypeOf("function");
    expect(Connection).toBeTypeOf("function");
    expect(PortEndpoint).toBeTypeOf("function");
    expect(BlockDefinition).toBeTypeOf("function");
    expect(TypeSystem).toBeTypeOf("function");
    expect(DiagramCompiler).toBeTypeOf("function");
    expect(CompilationModel).toBeTypeOf("function");
    expect(Library).toBeTypeOf("function");
  });
  test("lists every non-test model file as an asset", () => {
    expect([...modelAssetFiles].sort()).toEqual(modelSourceFiles());
  });

  test("lists every JSON schema as a published asset", () => {
    const schemaFiles = readdirSync(schemaDir)
      .filter((name) => name.endsWith(".schema.json"))
      .sort();
    expect(schemaAssetFiles).toEqual(schemaFiles);
    expect(schemaFiles).toEqual([
      "blocks.schema.json",
      "diagram.schema.json",
      "library.schema.json",
      "namespaces.schema.json",
      "types.schema.json",
    ]);
    expect(CoreSchemaCatalog.shared.diagramSchemaPath).toBe("schemas/diagram.schema.json");
  });

  test("implements strong OOP class hierarchies and abstractions", async () => {
    // DiagramElement hierarchy
    const { DiagramElement, Endpoint, InputPortEndpoint, OutputPortEndpoint, PropertyDefinition, PortDefinition, InputPortDefinition, OutputPortDefinition, ConfigPropertyDefinition, CompilerContext, BrowserCompilerContext, McuCompilerContext, AbstractAssetStore, AppAssetStore, DefaultDiagramPlanner } = await import("../../src/index.js") as any;

    expect(DiagramElement).toBeTypeOf("function");
    expect(Endpoint).toBeTypeOf("function");
    expect(PropertyDefinition).toBeTypeOf("function");
    expect(CompilerContext).toBeTypeOf("function");
    expect(AbstractAssetStore).toBeTypeOf("function");

    // Inheritance verification
    expect(DiagramBlock.prototype).toBeInstanceOf(DiagramElement);
    expect(Connection.prototype).toBeInstanceOf(DiagramElement);

    expect(PortEndpoint.prototype).toBeInstanceOf(Endpoint);
    expect(InputPortEndpoint.prototype).toBeInstanceOf(PortEndpoint);
    expect(OutputPortEndpoint.prototype).toBeInstanceOf(PortEndpoint);

    expect(PortDefinition.prototype).toBeInstanceOf(PropertyDefinition);
    expect(InputPortDefinition.prototype).toBeInstanceOf(PortDefinition);
    expect(OutputPortDefinition.prototype).toBeInstanceOf(PortDefinition);
    expect(ConfigPropertyDefinition.prototype).toBeInstanceOf(PropertyDefinition);

    expect(BrowserCompilerContext.prototype).toBeInstanceOf(CompilerContext);
    expect(McuCompilerContext.prototype).toBeInstanceOf(CompilerContext);

    expect(AppAssetStore.prototype).toBeInstanceOf(AbstractAssetStore);

    expect(SchemaCatalog).toBeTypeOf("function");
    expect(CoreSchemaCatalog.prototype).toBeInstanceOf(SchemaCatalog);

    const planner = new DefaultDiagramPlanner();
    expect(planner.plan).toBeTypeOf("function");
  });
});
