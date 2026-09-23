import { Diagram, Palette, TypeSystem, type BlockDefinition, type DiagramBlock, type Library } from "core";
import { createSignal, For, type Accessor } from "solid-js";

interface SplitPanelElement extends HTMLElement {
  position: number;
  primary?: "start" | "end";
}

const categoryOrder = ["sources", "transformers", "sinks"];

export class PaletteCatalog {
  constructor(private readonly libraries: readonly Library[]) {}

  sections(): { library: Library; categories: { id: string; label: string; blocks: BlockDefinition[] }[] }[] {
    return this.libraries.map((library) => ({
      library,
      categories: categoriesFor(library),
    }));
  }
}

export function Workspace(props: { libraries: readonly Library[] }) {
  const diagram = new Diagram("diagram", "Diagram", combinedPalette(props.libraries));
  const [blocks, setBlocks] = createSignal<DiagramBlock[]>([]);
  const catalog = new PaletteCatalog(props.libraries);
  const libraryIds = props.libraries.map((library) => library.id).join(" ");

  const place = (definition: BlockDefinition) => {
    const count = blocks().length;
    const placed = diagram.addBlock(definition, {
      x: 24 + (count % 4) * 168,
      y: 24 + Math.floor(count / 4) * 96,
    });
    setBlocks((current) => [...current, placed]);
  };

  return (
    <wa-split-panel class="workspace" ref={bindSplitPanel}>
      <section class="region region-palette" data-region="palette" data-libraries={libraryIds} slot="start">
        <h1 class="region-header">Palette</h1>
        <For each={catalog.sections()}>
          {(section) => (
            <section data-library={section.library.id}>
              <h2 class="library-name">{section.library.name}</h2>
              <For each={section.categories}>
                {(category) => (
                  <div class="palette-group" data-category={category.id}>
                    <h3 class="category-name">{category.label}</h3>
                    <For each={category.blocks}>
                      {(block) => (
                        <button
                          type="button"
                          class="palette-block"
                          data-block-id={block.id}
                          data-library={section.library.id}
                          title={block.description}
                          onClick={() => place(block)}
                        >
                          <span class="palette-block-title">{block.title}</span>
                          <span class="palette-block-id">{block.id}</span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </section>
          )}
        </For>
      </section>
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
  panel.position = 28;
  panel.primary = "start";
}

function categoriesFor(library: Library): { id: string; label: string; blocks: BlockDefinition[] }[] {
  const groups = new Map<string, BlockDefinition[]>();
  const blocks = library.palette.getBlocks().slice().sort((left, right) => {
    const rank = categoryRank(left.category) - categoryRank(right.category);
    if (rank !== 0) return rank;
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
  for (const block of blocks) {
    const category = block.category || "blocks";
    const list = groups.get(category);
    if (list) list.push(block);
    else groups.set(category, [block]);
  }
  return [...groups.entries()].map(([id, grouped]) => ({
    id,
    label: categoryLabel(id),
    blocks: grouped,
  }));
}

function categoryRank(category: string): number {
  const index = categoryOrder.indexOf(category);
  return index === -1 ? categoryOrder.length : index;
}

function categoryLabel(category: string): string {
  if (!category) return "Blocks";
  return category.charAt(0).toUpperCase() + category.slice(1);
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
