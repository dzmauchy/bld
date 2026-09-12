import { defaultEnvBindings, startRunWorker } from "runtime/run.ts";

type ParentPort = { postMessage: (value: unknown) => void };

const processRef = (
  globalThis as {
    process?: { getBuiltinModule?: (id: string) => { parentPort?: ParentPort | null } };
  }
).process;
const parentPort = processRef?.getBuiltinModule?.("worker_threads")?.parentPort;

/** Example run worker that forwards UI pin bindings to the host thread. */
startRunWorker({
  ...defaultEnvBindings(),
  sendPinF32(blockId: number, pin: number, value: number) {
    parentPort?.postMessage({ type: "pin", blockId, pin, value });
  },
});
