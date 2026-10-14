import { html } from "lit";
import "@awesome.me/webawesome/dist/components/icon/icon.js";
import { SignalElement } from "../elements/SignalElement.js";
import type { DiagramEditor } from "./diagramEditor.js";

/** Top-layer menu shared by mouse and touch, kept open across a held finger's release. */
export class DiagramContextMenu extends SignalElement {
  static override properties = { editor: { attribute: false } };
  declare editor: DiagramEditor | undefined;
  private hold: ReturnType<typeof setTimeout> | undefined;
  private pointerId: number | undefined;
  private origin = { x: 0, y: 0 };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("pointermove", this.move);
    window.addEventListener("pointerup", this.cancelHold);
    window.addEventListener("pointercancel", this.cancelHold);
    window.addEventListener("pointerdown", this.outsidePointerDown, true);
    window.addEventListener("blur", this.dismiss);
    window.addEventListener("scroll", this.dismiss, true);
    window.addEventListener("resize", this.dismiss);
  }

  override disconnectedCallback(): void {
    this.cancelHold();
    window.removeEventListener("pointermove", this.move);
    window.removeEventListener("pointerup", this.cancelHold);
    window.removeEventListener("pointercancel", this.cancelHold);
    window.removeEventListener("pointerdown", this.outsidePointerDown, true);
    window.removeEventListener("blur", this.dismiss);
    window.removeEventListener("scroll", this.dismiss, true);
    window.removeEventListener("resize", this.dismiss);
    super.disconnectedCallback();
  }

  contextMenu(event: MouseEvent): void {
    if (this.open(event.target, event.clientX, event.clientY)) event.preventDefault();
  }

  pointerDown(event: PointerEvent): void {
    this.cancelHold();
    if (event.pointerType === "mouse" || event.button !== 0 || !event.isPrimary) return;
    if (!(event.target instanceof Element) || event.target.closest("button, input, select, textarea")) return;
    this.pointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    this.hold = setTimeout(() => {
      this.cancelHold();
      this.open(event.target, event.clientX, event.clientY);
    }, 550);
  }

  private readonly move = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId && Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y) > 8) this.cancelHold();
  };

  private readonly outsidePointerDown = (event: PointerEvent): void => {
    if (this.querySelector("[popover]:popover-open") && event.target instanceof Node && !this.contains(event.target)) this.dismiss();
  };

  private readonly cancelHold = (): void => {
    if (this.hold !== undefined) clearTimeout(this.hold);
    this.hold = undefined;
    this.pointerId = undefined;
  };

  private readonly dismiss = (): void => {
    this.cancelHold();
    this.querySelector<HTMLElement>("[popover]")?.hidePopover();
  };

  private open(target: EventTarget | null, x: number, y: number): boolean {
    this.cancelHold();
    if (!this.editor?.selectContextTarget(target)) return false;
    const menu = this.querySelector<HTMLElement>("[popover]");
    if (!menu) return false;
    menu.showPopover();
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return true;
  }

  protected override render() {
    return html`<div class="diagram-context-menu" data-diagram-context-menu popover="manual" role="menu" aria-label="Diagram item"
      @keydown=${(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          this.dismiss();
          this.editor?.canvasElement()?.focus({ preventScroll: true });
        } else if (event.key === "Tab") this.dismiss();
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") event.preventDefault();
      }}>
      <button type="button" role="menuitem" data-context-delete @click=${() => {
        this.dismiss();
        this.editor?.deleteSelected();
        this.editor?.canvasElement()?.focus({ preventScroll: true });
      }}><wa-icon name="trash" aria-hidden="true"></wa-icon>Delete</button>
    </div>`;
  }
}
customElements.define("bld-diagram-context-menu", DiagramContextMenu);
