import { defaultEnvBindings, startRunWorker } from "runtime/run.ts";

const host = globalThis as unknown as { postMessage: (message: unknown) => void };

/**
 * Browser run worker: host math/pin bindings plus UI pin notifications.
 */
startRunWorker({
  ...defaultEnvBindings(),
  sendPinF32(blockId: number, pin: number, value: number) {
    host.postMessage({ type: "pin", blockId, pin, value });
  },
});
