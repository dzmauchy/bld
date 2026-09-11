import blocks from "core/assembly/blocks.ts?raw";
import context from "core/assembly/context.ts?raw";
import index from "core/assembly/index.ts?raw";
import { assemblyAssetFiles } from "core";

export const assemblyAssets = {
  "blocks.ts": blocks,
  "context.ts": context,
  "index.ts": index,
} satisfies Record<(typeof assemblyAssetFiles)[number], string>;
