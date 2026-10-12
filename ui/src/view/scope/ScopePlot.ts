import { html, nothing } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { ScopeCaptureBoard } from "./scopeCapture.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";
import type { DiagramRunController } from "../run/diagramRunController.js";
import { ScopePlotGeometry } from "./scopePlotGeometry.js";
import { ScopePlotPainter } from "./scopePlotPainter.js";

/** Live plot of every output on the selected scope. */
export class ScopePlot extends SignalElement {
  static override properties = {
    editor: { attribute: false }, blockId: { attribute: false }, board: { attribute: false },
    runner: { attribute: false }, onClose: { attribute: false },
  };
  declare editor: DiagramEditor | undefined;
  declare blockId: string | undefined;
  declare board: ScopeCaptureBoard | undefined;
  declare runner: DiagramRunController | undefined;
  declare onClose: (() => void) | undefined;
  private readonly painter = new ScopePlotPainter();
  private geometry: ScopePlotGeometry | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private observer: ResizeObserver | undefined;

  protected override updated(): void {
    const canvas = this.querySelector<HTMLCanvasElement>("[data-scope-canvas]") ?? undefined;
    if (canvas !== this.canvas) {
      this.observer?.disconnect();
      this.canvas = canvas;
      if (canvas && typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(() => this.paint());
        this.observer.observe(canvas);
      }
    }
    this.paint();
  }

  override disconnectedCallback(): void {
    this.observer?.disconnect();
    this.canvas = undefined;
    super.disconnectedCallback();
  }

  private paint(): void {
    if (this.canvas && this.geometry) this.painter.paint(this.canvas, this.geometry);
  }

  protected override render() {
    this.runner?.revision();
    this.editor?.placed();
    this.editor?.routes();
    const monitor = this.editor && this.blockId ? this.board?.monitorFor(this.editor.model, this.blockId) : undefined;
    const geometry = this.geometry = monitor ? ScopePlotGeometry.fromMonitor(monitor) : undefined;
    if (!geometry) return nothing;
    const extent = geometry.sampleExtent();
    return html`<aside class="scope-plot" data-scope-plot data-scope-block=${this.blockId}
      data-axis="shared" data-series-count=${geometry.series.length} data-domain-seconds=${geometry.domainSeconds}
      data-samples=${geometry.series.reduce((count, series) => count + series.samples.length, 0)}
      data-sample-min=${extent?.minimum ?? ""} data-sample-max=${extent?.maximum ?? ""}
      data-last=${geometry.series.map((series) => String(series.samples.at(-1) ?? "")).join(" ")}>
      <header class="scope-plot-header"><h2>Scope</h2>
        <button type="button" class="scope-close" data-scope-close @click=${() => this.onClose?.()}>Close</button>
      </header>
      <canvas class="scope-plot-canvas" data-scope-canvas></canvas>
      <ul class="scope-legend">${geometry.series.map((series) => html`
        <li data-scope-series=${series.channel} style=${styleMap({ color: series.color })}>
          <span class="scope-swatch" style=${styleMap({ "background-color": series.color })}></span>${series.label}
        </li>`)}</ul>
    </aside>`;
  }
}
customElements.define("bld-scope-plot", ScopePlot);
