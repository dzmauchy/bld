import { parentPort, workerData } from "node:worker_threads";
import { CppWasmCompiler } from "cpp/compiler.ts";
import { compilerHandler } from "cpp/workers/compiler.ts";
import { attachWorker } from "cpp/workers/host.ts";

// The browser worker handler/dispatcher runs unchanged on Node's real message transport.
globalThis.postMessage = (message, transfer) => parentPort!.postMessage(message, transfer as ArrayBuffer[]);
attachWorker(compilerHandler(new CppWasmCompiler(name => `${workerData.assetBase}/${name}`)));
const scope = globalThis as unknown as { onmessage(event: { data: unknown }): void };
parentPort!.on("message", data => scope.onmessage({ data }));
