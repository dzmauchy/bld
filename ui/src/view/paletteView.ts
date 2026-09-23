import type { BlockDefinition, Library } from "core";
import { RegionView } from "./regionView.js";

const categoryOrder = ["sources", "transformers", "sinks"];

export class PaletteView extends RegionView {
  private placeHandler: ((block: BlockDefinition) => void) | undefined;

  constructor(private readonly libraries: readonly Library[]) {
    super("palette");
    this.element.dataset.libraries = libraries.map((library) => library.id).join(" ");
    this.render();
  }

  bindPlace(handler: (block: BlockDefinition) => void): void {
    this.placeHandler = handler;
  }

  private render(): void {
    const header = document.createElement("h1");
    header.className = "region-header";
    header.textContent = "Palette";
    this.element.append(header);

    for (const library of this.libraries) {
      const section = document.createElement("section");
      section.dataset.library = library.id;
      const name = document.createElement("h2");
      name.className = "library-name";
      name.textContent = library.name;
      section.append(name);

      for (const [category, blocks] of this.groups(library)) {
        const group = document.createElement("div");
        group.className = "palette-group";
        group.dataset.category = category;
        const label = document.createElement("h3");
        label.className = "category-name";
        label.textContent = categoryLabel(category);
        group.append(label);
        for (const block of blocks) group.append(this.blockButton(block, library.id));
        section.append(group);
      }
      this.element.append(section);
    }
  }

  private groups(library: Library): Map<string, BlockDefinition[]> {
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
    return groups;
  }

  private blockButton(block: BlockDefinition, libraryId: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-block";
    button.dataset.blockId = block.id;
    button.dataset.library = libraryId;
    button.title = block.description;
    const title = document.createElement("span");
    title.className = "palette-block-title";
    title.textContent = block.title;
    const id = document.createElement("span");
    id.className = "palette-block-id";
    id.textContent = block.id;
    button.append(title, id);
    button.addEventListener("click", () => this.placeHandler?.(block));
    return button;
  }
}

function categoryRank(category: string): number {
  const index = categoryOrder.indexOf(category);
  return index === -1 ? categoryOrder.length : index;
}

function categoryLabel(category: string): string {
  if (!category) return "Blocks";
  return category.charAt(0).toUpperCase() + category.slice(1);
}
