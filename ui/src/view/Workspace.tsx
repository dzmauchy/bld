import { Diagram, Palette, TypeSystem, type Library } from "core";
import { onCleanup } from "solid-js";
import { DiagramCanvas, DragGhostView } from "./diagram/DiagramCanvas.js";
import { DiagramEditor } from "./diagram/diagramEditor.js";
import { PaletteColumn } from "./palette/paletteColumnWidth.js";
import { PalettePanel } from "./palette/PalettePanel.js";

interface SplitPanelElement extends HTMLElement {
  position: number;
  primary?: "start" | "end";
}

export function Workspace(props: { libraries: readonly Library[] }) {
  const editor = new DiagramEditor(new Diagram("diagram", "Diagram", combinedPalette(props.libraries)));
  editor.start();
  onCleanup(() => editor.destroy());

  return (
    <>
      <wa-split-panel class="workspace" ref={bindSplitPanel}>
        <PalettePanel
          libraries={props.libraries}
          armedId={editor.armedId}
          onPointerDown={(definition, event) => editor.palettePointerDown(definition, event)}
        />
        <DiagramCanvas editor={editor} />
      </wa-split-panel>
      <DragGhostView editor={editor} />
    </>
  );
}

function bindSplitPanel(element: HTMLElement): void {
  const panel = element as SplitPanelElement;
  panel.position = 23;
  panel.primary = "start";
  requestAnimationFrame(() => new PaletteColumn(panel).fit());
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
