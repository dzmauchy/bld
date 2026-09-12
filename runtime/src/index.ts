import "./compile";

export type {
  DiagramBlockJson,
  DiagramConnectionJson,
  DiagramEndpointJson,
  DiagramJson,
  DiagramPortJson,
  PackageManifest,
  WasmProfileName,
} from "./json";
export type { CompileOptions, DownstreamRef, PlannedBlock, WasmProgram } from "./program";
export type { CompileProgramOptions } from "./compile";
export type { CompileRequest, FetchText, LibraryAssemblyModule } from "./api";
export type { BlockSpec } from "./registry";
export type { PlanBlock, PlanConnection, PlanEndpoint, PlanInput } from "./plan";

export {
  BlockRegistry,
  defaultRegistry,
} from "./registry";
export {
  BlockEmitter,
  GpioEmitter,
  LibraryApi,
  PushEmitter,
  TickEmitter,
  confNum,
  confPins,
  installLibrary,
} from "./dsl";
export {
  applyAssemblyModule,
  compileDiagram,
  compileProgram,
  defaultFetchText,
  emitDiagramText,
  importAssemblySource,
  installAssemblySource,
  installLibraryFromUrl,
  loadLibraryManifest,
  resolveUrl,
} from "./api";
export { planDiagramJson, planProgram } from "./plan";
export { compileBrowserProgram, emitBrowserText } from "./compile";
export {
  BrowserWasmProfile,
  McuWasmProfile,
  WasmProfile,
  browserProfile,
  getWasmProfile,
  mcuProfile,
} from "./profile";
export { PUSH_BLOCK_REFS, TICK_BLOCK_REFS } from "./sets";
export {
  MEMORY_INITIAL_PAGES,
  MEMORY_MAX_PAGES,
  MAX_BLOCKS,
  MAX_PINS,
  MAX_INTERVALS,
  OFFSET_WRITE_COUNT,
  OFFSET_CLOSED,
  OFFSET_HAS_PIN,
  OFFSET_LAST_PIN,
  OFFSET_INTERVAL_PERIODS,
} from "./memory";
