import { defaultEnvBindings, startRunWorker } from "core/as/run.ts";

const host = globalThis as unknown as { postMessage: (message: unknown) => void };

/**
 * Browser run worker: default AssemblyScript env plus UI pin notifications.
 * Diagram hosts can add more `env` imports here; they are not serializable
 * over `postMessage`, so they must be closed over in this worker module.
 */
startRunWorker({
  ...defaultEnvBindings(),
  sendPinF32(blockId: number, pin: number, value: number) {
    host.postMessage({ type: "pin", blockId, pin, value });
  },
});
