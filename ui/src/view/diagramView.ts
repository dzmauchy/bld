import type { BlockDefinition, Diagram, DiagramBlock } from "core";
import { createEffect, createSignal } from "solid-js";
import { RegionView } from "./regionView.js";

export class DiagramView extends RegionView {
  private readonly canvas: HTMLElement;
  private readonly bump: () => void;

  constructor(readonly diagram: Diagram) {
    super("diagram");
    const header = document.createElement("h1");
    header.className = "region-header";
    header.textContent = diagram.title;
    this.canvas = document.createElement("div");
    this.canvas.className = "diagram-canvas";
    this.canvas.dataset.diagramId = diagram.id;
    this.element.append(header, this.canvas);

    const [revision, setRevision] = createSignal(0);
    this.bump = () => setRevision((value) => value + 1);
    createEffect(() => {
      revision();
      this.paint();
    });
  }

  place(definition: BlockDefinition): DiagramBlock {
    const count = this.diagram.getBlocks().length;
    const block = this.diagram.addBlock(definition, {
      x: 24 + (count % 4) * 168,
      y: 24 + Math.floor(count / 4) * 96,
    });
    this.bump();
    return block;
  }

  private paint(): void {
    const nodes: HTMLElement[] = [];
    for (const block of this.diagram.getBlocks()) {
      const node = document.createElement("article");
      node.className = "diagram-block";
      node.dataset.diagramBlock = block.id;
      node.dataset.blockRef = block.ref;
      node.style.left = `${block.x}px`;
      node.style.top = `${block.y}px`;
      const title = document.createElement("span");
      title.className = "diagram-block-title";
      title.textContent = block.definition.title;
      node.append(title);
      nodes.push(node);
    }
    this.canvas.replaceChildren(...nodes);
  }
}
