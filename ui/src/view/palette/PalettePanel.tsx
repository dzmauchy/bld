import type { BlockDefinition, Library, PortDefinition } from "core";
import { createSignal, For, Show, type Accessor } from "solid-js";
import { BlockGlyphCatalog } from "./blockGlyphs.js";
import {
  BlockAccent,
  LibraryListPalettePresenter,
  PaletteExpansion,
  type PaletteGroup,
} from "./palettePresenter.js";

export function PalettePanel(props: { libraries: readonly Library[]; onPlace: (definition: BlockDefinition) => void }) {
  const groups = new LibraryListPalettePresenter(props.libraries).present();
  const libraryIds = props.libraries.map((library) => library.id).join(" ");
  const [expansion, setExpansion] = createSignal(PaletteExpansion.expanded(groups));

  return (
    <section class="region region-palette" data-region="palette" data-libraries={libraryIds} slot="start">
      <header class="palette-header">
        <div>
          <h1 class="palette-title">Palette</h1>
          <p class="palette-subtitle">Click to place on the canvas</p>
        </div>
      </header>
      <div class="palette-list">
        <For each={groups}>
          {(group) => (
            <PaletteFolder
              group={group}
              depth={0}
              expansion={expansion}
              onToggle={(id) => setExpansion((current) => current.toggled(id))}
              onPlace={props.onPlace}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function PaletteFolder(props: {
  group: PaletteGroup;
  depth: number;
  expansion: Accessor<PaletteExpansion>;
  onToggle: (id: string) => void;
  onPlace: (definition: BlockDefinition) => void;
}) {
  const open = () => props.expansion().has(props.group.id);
  return (
    <div class={`palette-ns${props.depth > 0 ? " is-child" : ""}`} data-namespace={props.group.id}>
      <button
        class={`palette-ns-toggle${open() ? " open" : ""}`}
        type="button"
        style={{ "--palette-depth": String(props.depth) }}
        aria-expanded={open() ? "true" : "false"}
        title={props.group.hint}
        onClick={() => props.onToggle(props.group.id)}
      >
        {props.group.label}
      </button>
      <Show when={open()}>
        <div class={`palette-ns-body${props.depth > 0 ? " is-nested" : ""}`}>
          <Show when={props.group.blocks.length > 0}>
            <div class="palette-blocks-grid">
              <For each={props.group.blocks}>
                {(block) => (
                  <button
                    type="button"
                    class={`palette-item flow-node ${BlockAccent.forCategory(block.category).className}`}
                    data-block-id={block.id}
                    data-library={props.group.libraryId}
                    title={block.description || block.title}
                    onClick={() => props.onPlace(block)}
                  >
                    <div class="flow-node-port-col is-in">
                      <For each={portsOf(block.inputs)}>{(port) => <PortMark port={port} side="in" />}</For>
                    </div>
                    <div class="flow-node-body">
                      <span class="flow-node-icon" aria-hidden="true" innerHTML={BlockGlyphCatalog.shared.markup(block.icon)} />
                      <span class="flow-node-title">{block.title}</span>
                    </div>
                    <div class="flow-node-port-col is-out">
                      <For each={portsOf(block.outputs)}>{(port) => <PortMark port={port} side="out" />}</For>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <For each={props.group.children}>
            {(child) => (
              <PaletteFolder
                group={child}
                depth={props.depth + 1}
                expansion={props.expansion}
                onToggle={props.onToggle}
                onPlace={props.onPlace}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function PortMark(props: { port: PortDefinition; side: "in" | "out" }) {
  const pin = (
    <span class="block-port-anchor">
      <span class="block-port" title={props.port.id}></span>
    </span>
  );
  if (!props.port.vector) {
    return <div class={`block-port-row is-${props.side}`}>{pin}</div>;
  }
  return (
    <div class={`block-port-vector is-${props.side}`}>
      <div class="block-port-vector-pins">
        <div class={`block-port-row is-${props.side} is-vector`}>{pin}</div>
      </div>
      <span class="block-port-vector-rail" aria-hidden="true"></span>
    </div>
  );
}

function portsOf(ports: ReadonlyMap<string, PortDefinition>): PortDefinition[] {
  return [...ports.values()];
}
