import type { Library } from "core";
import { LibraryList } from "./libraries/libraryList.js";
import { SplitWorkspace } from "./view/splitWorkspace.js";

export class App {
  static readonly defaultLibraries = LibraryList.defaultIds;

  readonly libraries: readonly Library[];
  private readonly workspace: SplitWorkspace;

  constructor(libraryIds: readonly string[] = LibraryList.defaultIds) {
    this.libraries = new LibraryList(libraryIds).load();
    this.workspace = new SplitWorkspace(this.libraries);
  }

  get element(): HTMLElement {
    return this.workspace.element;
  }
}
