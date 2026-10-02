import { Diagram, Palette, TypeSystem, type BlockDefinition, type DiagramBlock, type Library } from "core";
import { createSignal, For, onMount, type Accessor } from "solid-js";
import { PaletteColumn } from "./palette/paletteColumnWidth.js";
import { PalettePanel } from "./palette/PalettePanel.js";

interface SplitPanelElement extends HTMLElement {
  position: number;
  primary?: "start" | "end";
}

export function Workspace(props: { libraries: readonly Library[] }) {
  const diagram = new Diagram("diagram", "Diagram", combinedPalette(props.libraries));
  const [blocks, setBlocks] = createSignal<DiagramBlock[]>([]);
  let panel: HTMLElement | undefined;
  onMount(() => {
    if (panel) new PaletteColumn(panel).fit();
  });

  const place = (definition: BlockDefinition) => {
    const count = blocks().length;
    const placed = diagram.addBlock(definition, {
      x: 24 + (count % 4) * 168,
      y: 24 + Math.floor(count / 4) * 96,
    });
    setBlocks((current) => [...current, placed]);
  };

  return (
    <wa-split-panel
      class="workspace"
      ref={(element) => {
        panel = element;
        bindSplitPanel(element);
      }}
    >
      <PalettePanel libraries={props.libraries} onPlace={place} />
      <DiagramCanvas diagram={diagram} blocks={blocks} />
    </wa-split-panel>
  );
}

function DiagramCanvas(props: { diagram: Diagram; blocks: Accessor<DiagramBlock[]> }) {
  return (
    <section class="region region-diagram" data-region="diagram" slot="end">
      <h1 class="region-header">{props.diagram.title}</h1>
      <div class="diagram-canvas" data-diagram-id={props.diagram.id}>
        <For each={props.blocks()}>
          {(block) => (
            <article
              class="diagram-block"
              data-diagram-block={block.id}
              data-block-ref={block.ref}
              style={{ left: `${block.x}px`, top: `${block.y}px` }}
            >
              <span class="diagram-block-title">{block.definition.title}</span>
            </article>
          )}
        </For>
      </div>
    </section>
  );
}

function bindSplitPanel(element: HTMLElement): void {
  const panel = element as SplitPanelElement;
  panel.position = 23;
  panel.primary = "start";
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
