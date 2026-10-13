import { html, nothing, svg } from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { ScopeCaptureBoard } from "./scopeCapture.js";
import type { DiagramEditor } from "../diagram/diagramEditor.js";
import type { DiagramRunController } from "../run/diagramRunController.js";
import { ScopePlotGeometry, ScopeSeriesStyle } from "./scopePlotGeometry.js";
import { ScopePlotLayout } from "./scopePlotLayout.js";

/** Live plot of every output on the selected scope. */
export class ScopePlot extends SignalElement {
  static override properties = {
    editor: { attribute: false }, blockId: { attribute: false }, board: { attribute: false },
    runner: { attribute: false }, onClose: { attribute: false },
    scopeEffects: { type: Boolean },
  };
  declare editor: DiagramEditor | undefined;
  declare blockId: string | undefined;
  declare board: ScopeCaptureBoard | undefined;
  declare runner: DiagramRunController | undefined;
  declare onClose: (() => void) | undefined;
  declare scopeEffects: boolean;
  private screen: HTMLElement | undefined;
  private width = 1000;
  private height = 180;
  private observer: ResizeObserver | undefined;

  constructor() {
    super();
    this.scopeEffects = true;
  }

  protected override updated(): void {
    const screen = this.querySelector<HTMLElement>(".scope-screen") ?? undefined;
    if (screen !== this.screen) {
      this.observer?.disconnect();
      this.screen = screen;
      if (screen && typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(([entry]) => {
          if (!entry) return;
          const width = Math.max(1, Math.round(entry.contentRect.width));
          const height = Math.max(1, Math.round(entry.contentRect.height));
          if (width === this.width && height === this.height) return;
          this.width = width;
          this.height = height;
          this.requestUpdate();
        });
        this.observer.observe(screen);
      }
    }
  }

  override disconnectedCallback(): void {
    this.observer?.disconnect();
    this.screen = undefined;
    super.disconnectedCallback();
  }

  protected override render() {
    this.runner?.revision();
    this.editor?.placed();
    this.editor?.routes();
    const monitor = this.editor && this.blockId ? this.board?.monitorFor(this.editor.model, this.blockId) : undefined;
    const geometry = monitor ? ScopePlotGeometry.fromMonitor(monitor) : undefined;
    if (!geometry) return nothing;
    const extent = geometry.sampleExtent();
    const layout = new ScopePlotLayout(this.width, this.height);
    return html`<aside class="scope-plot" data-scope-plot data-scope-block=${this.blockId}
      data-scope-effects=${this.scopeEffects ? "vintage" : "off"}
      data-axis="shared" data-series-count=${geometry.series.length} data-domain-seconds=${geometry.domainSeconds}
      data-axis-seconds=${geometry.axisSeconds} data-window-capacity=${geometry.series[0]?.buffer.capacity ?? 0}
      data-samples=${geometry.series.reduce((count, series) => count + series.buffer.size, 0)}
      data-sample-min=${extent?.minimum ?? ""} data-sample-max=${extent?.maximum ?? ""}
      data-last=${geometry.series.map((series) => series.buffer.size ? String(series.buffer.last()) : "").join(" ")}>
      <header class="scope-plot-header"><h2>Scope</h2>
        <button type="button" class="scope-close" data-scope-close @click=${() => this.onClose?.()}>Close</button>
      </header>
      <div class=${`scope-screen${this.scopeEffects ? " is-vintage" : ""}`}>
        <svg class="scope-plot-svg" data-scope-svg viewBox=${`0 0 ${this.width} ${this.height}`}
          preserveAspectRatio="none" role="img" aria-label="Scope signals over time">
          <path class="scope-grid" d=${layout.gridPath()}></path>
          <g class="scope-traces">${geometry.series.map(series => svg`
            <path class="scope-trace" data-scope-trace=${series.channel}
              style=${styleMap({ color: series.color })} d=${layout.tracePath(geometry, series)}></path>`)}</g>
          <rect class="scope-frame" x=${layout.left} y=${layout.top}
            width=${layout.right - layout.left} height=${layout.bottom - layout.top}></rect>
          <g class="scope-axis-label">
            <text x=${layout.left} y=${layout.bottom + 6} dominant-baseline="hanging">0s</text>
            <text x=${layout.right} y=${layout.bottom + 6} text-anchor="end" dominant-baseline="hanging">${ScopeSeriesStyle.label(geometry.axisSeconds)}s</text>
            <text x=${layout.left - 6} y=${layout.top + 11} text-anchor="end">${ScopeSeriesStyle.label(geometry.maximum)}</text>
            <text x=${layout.left - 6} y=${layout.bottom - 11} text-anchor="end" dominant-baseline="hanging">${ScopeSeriesStyle.label(geometry.minimum)}</text>
          </g>
        </svg>
      </div>
      <ul class="scope-legend">${geometry.series.map((series) => html`
        <li data-scope-series=${series.channel} style=${styleMap({ color: series.color })}>
          <span class="scope-swatch" style=${styleMap({ "background-color": series.color })}></span>${series.label}
        </li>`)}</ul>
    </aside>`;
  }
}
customElements.define("bld-scope-plot", ScopePlot);
