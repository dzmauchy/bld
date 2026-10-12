import "@awesome.me/webawesome/dist/components/dialog/dialog.js";
import { html, nothing, svg } from "lit";
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
        <p>Starting diagram…</p>
        <ol class="compile-steps" aria-label="Diagram startup steps">
          ${runner.progress().items().map((step) => html`<li class=${`compile-step is-${step.status}`}
            data-compile-step=${step.phase} data-step-status=${step.status}
            aria-current=${step.status === "active" ? "step" : nothing}>
            <span class="compile-step-mark" aria-hidden="true">${step.status === "completed"
              ? svg`<svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>`
              : svg`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>`}</span>
            <span>${step.label}</span><span class="toolbar-announcement">${step.status}</span>
          </li>`)}
        </ol>
      </div>` : html`<p class="run-error-message" data-run-error role="alert">${error}</p>
        <button slot="footer" class="run-error-dismiss" data-dismiss-run-error
          @click=${() => runner.dismissError()}>OK</button>`}
    </wa-dialog>`;
  }
}
customElements.define("bld-run-feedback", RunFeedback);
