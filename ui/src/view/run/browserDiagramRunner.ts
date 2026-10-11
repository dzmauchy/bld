import { BrowserCompiler, type Diagram, type Library } from "core";
import { BrowserCppRuntime } from "cpp";
import { createBrowserWasmRuntime } from "../../wasm/runtime.js";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import { DiagramRunController } from "./diagramRunController.js";

/** Browser compiler and worker runtime for the open diagram. */
export class BrowserDiagramRunner {
  static create(diagram: Diagram, libraries: readonly Library[], board: ScopeCaptureBoard): DiagramRunController {
    return new DiagramRunController(
      diagram,
      board,
      () => new BrowserCompiler(libraryFiles(libraries), BrowserCppRuntime.shared().compiler),
      (onHostMessage) => createBrowserWasmRuntime({ onHostMessage }),
    );
  }
}

function libraryFiles(libraries: readonly Library[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const library of libraries) Object.assign(files, library.compilationModel.getFiles());
  return files;
}
