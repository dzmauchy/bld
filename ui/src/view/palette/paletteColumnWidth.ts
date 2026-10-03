/** Palette column width: the wider of the titles and two block buttons, plus slack. */
export class PaletteColumnWidth {
  constructor(
    private readonly widestTitle: number,
    private readonly twoButtons: number,
    private readonly slack: number,
  ) {}

  pixels(): number {
    return Math.max(this.widestTitle, this.twoButtons) + this.slack;
  }
}

/** Reads the palette and returns the column width that fits its titles and two buttons. */
export class PaletteContentWidth {
  constructor(private readonly palette: HTMLElement) {}

  column(): PaletteColumnWidth {
    return new PaletteColumnWidth(this.widestTitle(), this.twoButtons(), this.slack());
  }

  private widestTitle(): number {
    let widest = 0;
    for (const node of this.palette.querySelectorAll(PaletteTitle.selector)) {
      if (!(node instanceof HTMLElement)) continue;
      widest = Math.max(widest, new PaletteTitle(node, this.palette).pixels());
    }
    return widest;
  }

  private twoButtons(): number {
    const grid = this.palette.querySelector(".palette-blocks-grid");
    if (!(grid instanceof HTMLElement)) return 0;
    const style = getComputedStyle(grid);
    const button = new ResolvedLength(this.palette, "var(--palette-button-width)").pixels();
    const gap = lengthPx(style.columnGap);
    const padding = lengthPx(style.paddingLeft) + lengthPx(style.paddingRight);
    return button * 2 + gap + padding;
  }

  private slack(): number {
    return new ResolvedLength(this.palette, "var(--palette-column-slack)").pixels();
  }
}

/** Pins the split panel's start column to the measured palette width. */
export class PaletteColumn {
  constructor(private readonly panel: HTMLElement) {}

  fit(): void {
    const palette = this.panel.querySelector("[data-region=palette]");
    if (!(palette instanceof HTMLElement)) return;
    const width = new PaletteContentWidth(palette).column().pixels();
    if (width <= 0) return;
    const css = `${width}px`;
    this.panel.style.setProperty("--min", css);
    this.panel.style.setProperty("--max", css);
  }
}

/** Shrink-wrapped width of a palette title, including its padding and markers. */
class PaletteTitle {
  static readonly selector = ".palette-ns-toggle, .flow-node-title";

  constructor(
    private readonly element: HTMLElement,
    private readonly host: HTMLElement,
  ) {}

  pixels(): number {
    const clone = this.element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return 0;
    clone.style.position = "absolute";
    clone.style.visibility = "hidden";
    clone.style.width = "max-content";
    clone.style.maxWidth = "none";
    clone.style.minWidth = "max-content";
    if (getComputedStyle(this.element).display === "inline") clone.style.display = "inline-block";
    this.host.appendChild(clone);
    try {
      return clone.getBoundingClientRect().width;
    } finally {
      clone.remove();
    }
  }
}

/** Resolves a CSS length against the palette so custom properties and rem apply. */
class ResolvedLength {
  constructor(
    private readonly host: HTMLElement,
    private readonly value: string,
  ) {}

  pixels(): number {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = this.value;
    this.host.appendChild(probe);
    try {
      return probe.getBoundingClientRect().width;
    } finally {
      probe.remove();
    }
  }
}

function lengthPx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
