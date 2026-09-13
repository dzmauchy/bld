import { hostPinEnvBindings, startRunWorker } from "runtime/run.ts";

/**
 * Browser run worker: host math/pin bindings plus UI pin notifications.
 */
startRunWorker(hostPinEnvBindings());
