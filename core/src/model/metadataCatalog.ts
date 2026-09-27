import type { RawBlockCatalogEntry, RawPortCatalogEntry } from "./blockDefinition";

interface MetadataEntry {
  id: string;
  namespace?: string;
  name?: string;
  description?: string;
  icon?: string;
  inputs?: MetadataEntry[];
  outputs?: MetadataEntry[];
}

/** The release manifest is the authority for exposed blocks and ports. */
export class MetadataCatalog {
  readonly blocks: Record<string, RawBlockCatalogEntry> = {};
  readonly namespaces: Record<string, unknown> = {};

  constructor(metadata: unknown) {
    const meta = metadata as { blocks?: MetadataEntry[]; namespaces?: MetadataEntry[] };
    if (!Array.isArray(meta?.blocks) || !Array.isArray(meta.namespaces)) {
      throw new Error("meta.json must contain blocks and namespaces arrays");
    }
    for (const entry of meta.namespaces) {
      let children = this.namespaces;
      for (const part of entry.id.split("::")) {
        const node = (children[part] ??= { name: part, children: {} }) as Record<string, unknown>;
        if (part === entry.id.split("::").at(-1)) Object.assign(node, entry);
        children = node.children as Record<string, unknown>;
      }
    }
    for (const entry of meta.blocks) {
      if (!/^[A-Za-z_]\w*$/.test(entry.id) || !/^[A-Za-z_]\w*(::[A-Za-z_]\w*)*$/.test(entry.namespace ?? "")) {
        throw new Error(`Invalid C++ block name ${entry.id}`);
      }
      if (this.blocks[entry.id]) throw new Error(`Duplicate block ${entry.id}`);
      this.blocks[entry.id] = {
        ns: entry.namespace!.split("::"),
        cpp: `${entry.namespace}::${entry.id}<>`,
        title: entry.name ?? entry.id,
        description: entry.description ?? "",
        icon: entry.icon ?? "",
        inputs: this.ports(entry.inputs ?? []),
        outputs: this.ports(entry.outputs ?? []),
      };
    }
  }

  private ports(entries: MetadataEntry[]): Record<string, RawPortCatalogEntry> {
    return Object.fromEntries(entries.map((entry) => {
      if (!/^[A-Za-z_]\w*$/.test(entry.id)) throw new Error(`Invalid port ${entry.id}`);
      return [entry.id, { type: "auto" }];
    }));
  }
}
