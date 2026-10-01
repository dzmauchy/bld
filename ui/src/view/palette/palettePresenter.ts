import type { BlockDefinition, Library } from "core";

const flowOrder = ["sources", "transformers", "sinks"];

/** One collapsible folder in the palette: a namespace, or a library when several are open. */
export class PaletteGroup {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly blocks: readonly BlockDefinition[],
    readonly children: readonly PaletteGroup[],
    readonly hint: string,
    readonly libraryId: string,
  ) {}

  ids(): string[] {
    return [this.id, ...this.children.flatMap((child) => child.ids())];
  }
}

/** Which namespace folders are expanded. Toggling returns a new instance. */
export class PaletteExpansion {
  private constructor(private readonly openIds: ReadonlySet<string>) {}

  static expanded(groups: readonly PaletteGroup[]): PaletteExpansion {
    return new PaletteExpansion(new Set(groups.flatMap((group) => group.ids())));
  }

  has(id: string): boolean {
    return this.openIds.has(id);
  }

  toggled(id: string): PaletteExpansion {
    const next = new Set(this.openIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return new PaletteExpansion(next);
  }
}

/** Accent used by a palette tile, matching the BLDjs block-kind colors. */
export class BlockAccent {
  private constructor(readonly className: string) {}

  static readonly data = new BlockAccent("block-kind-data");
  static readonly process = new BlockAccent("block-kind-process");
  static readonly output = new BlockAccent("block-kind-output");

  static forCategory(category: string): BlockAccent {
    switch (category) {
      case "sources":
        return BlockAccent.data;
      case "sinks":
        return BlockAccent.output;
      default:
        return BlockAccent.process;
    }
  }
}

export abstract class PalettePresenter {
  abstract present(): readonly PaletteGroup[];
}

/** Namespace tree for a single library. Empty folders, including unused namespaces, are omitted. */
export class NamespacePalettePresenter extends PalettePresenter {
  constructor(private readonly library: Library) {
    super();
  }

  present(): readonly PaletteGroup[] {
    const catalog = catalogIndex(this.library.namespaces);
    const drafts = new Map<string, DraftGroup>();
    for (const block of this.library.palette.getBlocks()) {
      const id = block.namespace.length > 0 ? block.namespace.join("::") : "blocks";
      ensureChain(id, drafts, catalog, this.library.id);
      drafts.get(id)?.blocks.push(block);
    }
    for (const draft of drafts.values()) {
      draft.blocks.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
    }

    const roots: DraftGroup[] = [];
    for (const draft of drafts.values()) {
      const parentId = parentOf(draft.id);
      const parent = parentId ? drafts.get(parentId) : undefined;
      if (parent) parent.children.set(draft.id, draft);
      else roots.push(draft);
    }
    return roots.map(materialize).filter((group): group is PaletteGroup => group !== undefined).sort(compareGroups);
  }
}

/** One tree when a single library is loaded, otherwise a folder per library. */
export class LibraryListPalettePresenter extends PalettePresenter {
  constructor(private readonly libraries: readonly Library[]) {
    super();
  }

  present(): readonly PaletteGroup[] {
    const sections = this.libraries.map((library) => ({
      library,
      groups: new NamespacePalettePresenter(library).present(),
    }));
    const only = sections[0];
    if (!only || sections.length === 1) return only?.groups ?? [];
    return sections.map(
      ({ library, groups }) => new PaletteGroup(library.id, library.name, [], groups, library.name, library.id),
    );
  }
}

interface CatalogNode {
  id?: string;
  name?: string;
  children?: Record<string, CatalogNode>;
}

class DraftGroup {
  readonly blocks: BlockDefinition[] = [];
  readonly children = new Map<string, DraftGroup>();

  constructor(
    readonly id: string,
    readonly label: string,
    readonly hint: string,
    readonly libraryId: string,
  ) {}
}

function catalogIndex(namespaces: Record<string, unknown>): Map<string, { name?: string }> {
  const found = new Map<string, { name?: string }>();
  const visit = (segment: string, node: CatalogNode, parentId: string) => {
    const id = node.id && node.id.length > 0 ? node.id : parentId ? `${parentId}::${segment}` : segment;
    if (node.name && node.name.length > 0) found.set(id, { name: node.name });
    else found.set(id, {});
    for (const [childSegment, child] of Object.entries(node.children ?? {})) {
      if (child && typeof child === "object") visit(childSegment, child, id);
    }
  };
  for (const [segment, node] of Object.entries(namespaces)) {
    if (node && typeof node === "object") visit(segment, node as CatalogNode, "");
  }
  return found;
}

function ensureChain(
  id: string,
  drafts: Map<string, DraftGroup>,
  catalog: Map<string, { name?: string }>,
  libraryId: string,
): void {
  let current = "";
  for (const part of id.split("::")) {
    current = current ? `${current}::${part}` : part;
    if (drafts.has(current)) continue;
    const name = catalog.get(current)?.name;
    const label = labelFor(current, name);
    drafts.set(current, new DraftGroup(current, label, name?.trim() || label, libraryId));
  }
}

function labelFor(id: string, name: string | undefined): string {
  const segment = id.split("::").at(-1) ?? id;
  const trimmed = name?.trim() ?? "";
  if (trimmed && trimmed.length <= 22 && trimmed.toLowerCase() !== segment.toLowerCase()) return trimmed;
  const precision = /^f_?(\d+)$/.exec(segment);
  if (precision?.[1]) return `F${precision[1]}`;
  if (!segment) return "Blocks";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function parentOf(id: string): string {
  const parts = id.split("::");
  parts.pop();
  return parts.join("::");
}

function materialize(draft: DraftGroup): PaletteGroup | undefined {
  const children = [...draft.children.values()]
    .map(materialize)
    .filter((group): group is PaletteGroup => group !== undefined)
    .sort(compareGroups);
  if (draft.blocks.length === 0 && children.length === 0) return undefined;
  return new PaletteGroup(draft.id, draft.label, draft.blocks, children, draft.hint, draft.libraryId);
}

function compareGroups(left: PaletteGroup, right: PaletteGroup): number {
  const leftRank = flowOrder.indexOf(leaf(left.id));
  const rightRank = flowOrder.indexOf(leaf(right.id));
  if (leftRank !== -1 || rightRank !== -1) {
    const leftScore = leftRank === -1 ? flowOrder.length : leftRank;
    const rightScore = rightRank === -1 ? flowOrder.length : rightRank;
    if (leftScore !== rightScore) return leftScore - rightScore;
  }
  return left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function leaf(id: string): string {
  return id.split("::").at(-1) ?? id;
}
