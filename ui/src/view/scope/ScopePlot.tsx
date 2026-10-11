import type { Diagram } from "core";
import type { Accessor } from "solid-js";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { ScopeCaptureBoard } from "./scopeCapture.js";
import { ScopePlotGeometry } from "./scopePlotGeometry.js";
import { ScopePlotPainter } from "./scopePlotPainter.js";

/** Live plot of every output on the scope that was clicked. */
export function ScopePlot(props: {
  diagram: Diagram;
  blockId: string;
  board: ScopeCaptureBoard;
  revision: Accessor<number>;
  placed: Accessor<readonly unknown[]>;
  routes: Accessor<readonly unknown[]>;
  onClose: () => void;
}) {
  const painter = new ScopePlotPainter();
  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>();
  const plot = (): ScopePlotGeometry | undefined => {
    props.revision();
    props.placed();
    props.routes();
    const monitor = props.board.monitorFor(props.diagram, props.blockId);
    return monitor ? ScopePlotGeometry.fromMonitor(monitor) : undefined;
  };
  const paint = (): void => {
    const element = canvas();
    const geometry = plot();
    if (!element || !geometry) return;
    painter.paint(element, geometry);
  };
  createEffect(
    () => ({ plot: plot(), element: canvas() }),
    () => paint(),
  );
  createEffect(
    () => canvas(),
    (element) => {
      if (!element || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => paint());
      observer.observe(element);
      return () => observer.disconnect();
    },
  );

  return (
    <Show when={plot()}>
      {(geometry) => (
        <aside
          class="scope-plot"
          data-scope-plot
          data-scope-block={props.blockId}
          data-axis="shared"
          data-series-count={geometry().series.length}
          data-domain-seconds={geometry().domainSeconds}
        >
          <header class="scope-plot-header">
            <h2>Scope</h2>
            <button type="button" class="scope-close" data-scope-close onClick={() => props.onClose()}>
              Close
            </button>
          </header>
          <canvas class="scope-plot-canvas" data-scope-canvas ref={setCanvas} />
          <ul class="scope-legend">
            <For each={geometry().series}>
              {(series) => (
                <li data-scope-series={series.channel} style={{ color: series.color }}>
                  <span class="scope-swatch" style={{ "background-color": series.color }} />
                  {series.label}
                </li>
              )}
            </For>
          </ul>
        </aside>
      )}
    </Show>
  );
}
