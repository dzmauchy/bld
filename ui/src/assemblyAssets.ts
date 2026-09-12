import blocks from "core/assets/assembly/blocks.ts?raw";
import context from "core/assets/assembly/context.ts?raw";
import index from "core/assets/assembly/index.ts?raw";
import { assemblyAssetFiles } from "core";

export const assemblyAssets = {
  "blocks.ts": blocks,
  "context.ts": context,
  "index.ts": index,
} satisfies Record<(typeof assemblyAssetFiles)[number], string>;
