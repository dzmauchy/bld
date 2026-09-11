import basic from "core/model/basic.ts?raw";
import context from "core/model/context.ts?raw";
import diagram from "core/model/diagram.ts?raw";
import gpio from "core/model/gpio.ts?raw";
import messages from "core/model/messages.ts?raw";
import push from "core/model/push.ts?raw";
import { modelAssetFiles } from "core";

export const modelAssets = {
  "basic.ts": basic,
  "context.ts": context,
  "diagram.ts": diagram,
  "gpio.ts": gpio,
  "messages.ts": messages,
  "push.ts": push,
} satisfies Record<(typeof modelAssetFiles)[number], string>;
