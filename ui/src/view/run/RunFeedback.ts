import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import { html, nothing } from "lit";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramRunController } from "./diagramRunController.js";

/** Blocks editing during startup and presents failures after stopping the run. */
export class RunFeedback extends SignalElement {
  static override properties = { runner: { attribute: false } };
  declare runner: DiagramRunController | undefined;

  protected override render() {
    const runner = this.runner;
    if (!runner) return nothing;
    const compiling = runner.phase() === "starting";
    const error = runner.error();
    if (!compiling && !error) return nothing;
    return html`<wa-dialog class="run-feedback" data-run-feedback
      data-compiling=${String(compiling)} label=${compiling ? "Compiling diagram" : "Diagram cannot run"}
      .open=${true} .withoutHeader=${compiling} .lightDismiss=${false}
      @wa-hide=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        if (compiling) event.preventDefault();
        else runner.dismissError();
      }}>
      ${compiling ? html`<div class="compile-progress" role="status">
        <wa-spinner aria-label="Compiling"></wa-spinner><p>Compiling diagram…</p>
      </div>` : html`<p class="run-error-message" data-run-error role="alert">${error}</p>
        <button slot="footer" class="run-error-dismiss" data-dismiss-run-error
          @click=${() => runner.dismissError()}>OK</button>`}
    </wa-dialog>`;
  }
}
customElements.define("bld-run-feedback", RunFeedback);
