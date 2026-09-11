import basic from "core/assembly/basic.ts?raw";
import context from "core/assembly/context.ts?raw";
import gpio from "core/assembly/gpio.ts?raw";
import index from "core/assembly/index.ts?raw";
import push from "core/assembly/push.ts?raw";
import types from "core/assembly/types.ts?raw";
import { assemblyAssetFiles } from "core";

export const assemblyAssets = {
  "basic.ts": basic,
  "context.ts": context,
  "gpio.ts": gpio,
  "index.ts": index,
  "push.ts": push,
  "types.ts": types,
} satisfies Record<(typeof assemblyAssetFiles)[number], string>;
