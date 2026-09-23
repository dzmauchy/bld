export abstract class RegionView {
  readonly element: HTMLElement;

  protected constructor(region: "palette" | "diagram") {
    this.element = document.createElement("section");
    this.element.className = `region region-${region}`;
    this.element.dataset.region = region;
  }
}
