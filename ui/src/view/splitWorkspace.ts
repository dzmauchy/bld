import { Diagram, Palette, TypeSystem, type Library } from "core";
import { DiagramView } from "./diagramView.js";
import { PaletteView } from "./paletteView.js";

interface SplitPanelElement extends HTMLElement {
  position: number;
  primary?: "start" | "end";
}

export class SplitWorkspace {
  readonly element: HTMLElement;
  readonly paletteView: PaletteView;
  readonly diagramView: DiagramView;

  constructor(libraries: readonly Library[]) {
    const diagram = new Diagram("diagram", "Diagram", combinedPalette(libraries));
    this.paletteView = new PaletteView(libraries);
    this.diagramView = new DiagramView(diagram);
    this.paletteView.bindPlace((block) => this.diagramView.place(block));

    const split = document.createElement("wa-split-panel") as SplitPanelElement;
    split.className = "workspace";
    split.position = 28;
    split.primary = "start";
    this.paletteView.element.slot = "start";
    this.diagramView.element.slot = "end";
    split.append(this.paletteView.element, this.diagramView.element);
    this.element = split;
  }
}

function combinedPalette(libraries: readonly Library[]): Palette {
  const first = libraries[0];
  if (!first) return new Palette(new TypeSystem());
  if (libraries.length === 1) return first.palette;
  const palette = new Palette(first.typeSystem);
  for (const library of libraries) {
    for (const block of library.palette.getBlocks()) palette.registerBlock(block);
  }
  return palette;
}
