import { hostPinEnvBindings, startRunWorker } from "./run.ts";

/** Example run worker that forwards UI pin bindings to the host thread. */
startRunWorker(hostPinEnvBindings());
