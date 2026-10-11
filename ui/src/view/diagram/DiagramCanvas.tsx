import type { DiagramEditor } from "./diagramEditor.js";
import { For, Show } from "solid-js";
import { BlockAccent } from "../palette/palettePresenter.js";
import { BlockGlyphCatalog } from "../palette/blockGlyphs.js";
import { BlockConfigDialog } from "./BlockConfigDialog.js";
import { GearIcon } from "./GearIcon.js";
import type { DiagramRunController } from "../run/diagramRunController.js";
import { ScopePlot } from "../scope/ScopePlot.js";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import { WirePolyline } from "./geometry.js";

export function DiagramCanvas(props: { editor: DiagramEditor; board: ScopeCaptureBoard; runner: DiagramRunController }) {
  const extent = () => {
    let width = 0;
    let height = 0;
    const grow = (x: number, y: number) => {
      width = Math.max(width, x);
      height = Math.max(height, y);
    };
    for (const block of props.editor.placed()) {
      grow(block.x + block.frame.width + 80, block.y + block.frame.height + 80);
    }
    for (const route of props.editor.routes()) {
      for (const point of route.points) grow(point.x + 32, point.y + 32);
    }
    for (const point of props.editor.draft() ?? []) grow(point.x + 32, point.y + 32);
    return { width, height };
  };

  return (
    <section class="region region-diagram" data-region="diagram" slot="end">
      <div
        class={`diagram-canvas${props.editor.armedId() ? " is-armed" : ""}${props.editor.receiving() ? " is-receiving" : ""}`}
        data-diagram-canvas
        data-armed={props.editor.armedId() ?? ""}
        ref={(element) => props.editor.attachCanvas(element)}
        onPointerDown={(event) => props.editor.canvasPointerDown(event)}
      >
        <div class="diagram-extent" style={{ width: `${extent().width}px`, height: `${extent().height}px` }} />
        <svg class="diagram-wires" data-diagram-wires>
          <defs>
            <marker id="diagram-wire-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L7,3 L0,6 Z" />
            </marker>
          </defs>
          <For each={props.editor.routes()} keyed={(route) => route.connectionId}>
            {(route) => (
              <polyline
                class="diagram-wire"
                data-connection={route().connectionId}
                data-route-origin={route().origin}
                points={route().pointsAttribute}
                marker-end="url(#diagram-wire-arrow)"
              />
            )}
          </For>
          <Show when={props.editor.draft()}>
            {(points) => <polyline class="diagram-wire is-draft" points={WirePolyline.pointsAttribute(points())} />}
          </Show>
        </svg>
        <For each={props.editor.placed()} keyed={(block) => block.id}>
          {(block) => (
            <article
              class={`diagram-block ${BlockAccent.forCategory(block().category).className}${props.editor.movingId() === block().id ? " is-moving" : ""}`}
              data-diagram-block={block().id}
              data-block-ref={block().ref}
              data-inspected={props.editor.inspectedId() === block().id ? "true" : "false"}
              style={{
                left: `${block().x}px`,
                top: `${block().y}px`,
                width: `${block().frame.width}px`,
                height: `${block().frame.height}px`,
              }}
            >
              <div class="diagram-block-body">
                <span class="diagram-block-icon" aria-hidden="true" innerHTML={BlockGlyphCatalog.shared.markup(block().icon)} />
                <span class="diagram-block-title">{block().title}</span>
              </div>
              <Show when={block().configurable}>
                <button
                  type="button"
                  class="diagram-block-config"
                  data-block-config={block().id}
                  title="Configure"
                  aria-label={`Configure ${block().title}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.editor.openConfiguration(block().id);
                  }}
                >
                  <GearIcon />
                </button>
              </Show>
              <For each={block().frame.ports} keyed={(port) => `${port.side}:${port.id}`}>
                {(port) => (
                  <span
                    class={`diagram-port is-${port().side}${port().vector ? " is-vector" : ""}`}
                    data-port-id={port().id}
                    data-port-side={port().side}
                    data-port-lanes={port().lanes}
                    title={port().id}
                    style={{
                      left: `${port().x}px`,
                      top: `${port().y}px`,
                      height: port().vector ? `${port().span}px` : undefined,
                    }}
                  >
                    <Show when={port().vector}>
                      <span class="diagram-port-rail" />
                      <For each={port().pins()}>
                        {(pin) => (
                          <span
                            class="diagram-port-pin"
                            data-port-pin
                            data-vector-index={pin.index}
                            style={{ top: `${pin.top}px` }}
                          />
                        )}
                      </For>
                    </Show>
                  </span>
                )}
              </For>
            </article>
          )}
        </For>
      </div>
      <Show when={props.editor.configuredId()}>
        {(blockId) => {
          const block = () => props.editor.model.getBlock(blockId());
          return (
            <Show when={block()}>
              {(configured) => (
                <BlockConfigDialog
                  block={configured()}
                  revision={props.editor.configRevision()}
                  onCommit={() => {
                    props.editor.noteConfiguration();
                    if (props.runner.phase() === "running") void props.runner.stop();
                  }}
                  onClose={() => props.editor.closeConfiguration()}
                />
              )}
            </Show>
          );
        }}
      </Show>
      <Show when={props.editor.inspectedId()}>
        {(blockId) => (
          <ScopePlot
            diagram={props.editor.model}
            blockId={blockId()}
            board={props.board}
            revision={props.runner.revision}
            placed={props.editor.placed}
            routes={props.editor.routes}
            onClose={() => props.editor.closeInspection()}
          />
        )}
      </Show>
    </section>
  );
}

export function DragGhostView(props: { editor: DiagramEditor }) {
  return (
    <Show when={props.editor.ghost()}>
      {(ghost) => (
        <div
          class={`palette-drag-ghost ${ghost().accentClass}`}
          aria-hidden="true"
          style={{
            width: `${ghost().width}px`,
            height: `${ghost().height}px`,
            transform: `translate(${ghost().x}px, ${ghost().y}px) translate(-50%, -50%)`,
          }}
        >
          {ghost().title}
        </div>
      )}
    </Show>
  );
}
