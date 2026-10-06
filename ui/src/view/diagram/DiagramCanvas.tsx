import type { DiagramEditor } from "./diagramEditor.js";
import { For, Show } from "solid-js";
import { BlockAccent } from "../palette/palettePresenter.js";
import { BlockGlyphCatalog } from "../palette/blockGlyphs.js";
import { WirePolyline } from "./geometry.js";

export function DiagramCanvas(props: { editor: DiagramEditor }) {
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
      <h1 class="region-header">Diagram</h1>
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
              <For each={block().frame.ports} keyed={(port) => `${port.side}:${port.id}`}>
                {(port) => (
                  <span
                    class={`diagram-port is-${port().side}${port().vector ? " is-vector" : ""}`}
                    data-port-id={port().id}
                    data-port-side={port().side}
                    title={port().id}
                    style={{ left: `${port().x}px`, top: `${port().y}px` }}
                  />
                )}
              </For>
            </article>
          )}
        </For>
      </div>
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
