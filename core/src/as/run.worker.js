import { parentPort } from "node:worker_threads";

if (!parentPort) {
  throw new Error("run.worker must run as a worker thread");
}

/** @type {WebAssembly.Instance | null} */
let instance = null;

parentPort.on("message", async (message) => {
  const { id, type } = message;
  try {
    if (type === "instantiate") {
      instance = await instantiateWasm(message.wasm);
      parentPort.postMessage({ id, type: "ok" });
      return;
    }
    if (type === "invoke") {
      if (!instance) throw new Error("wasm is not instantiated");
      const fn = instance.exports[message.name];
      if (typeof fn !== "function") {
        throw new Error(`missing wasm export ${message.name}`);
      }
      const result = fn(...(message.args ?? []));
      parentPort.postMessage({ id, type: "ok", result: result ?? 0 });
      return;
    }
    throw new Error(`unknown run worker message ${type}`);
  } catch (error) {
    parentPort.postMessage({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

async function instantiateWasm(wasm) {
  const { instance: created } = await WebAssembly.instantiate(wasm, {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(`AssemblyScript abort at ${line}:${column}`);
      },
      seed() {
        return 1;
      },
    },
  });
  return created;
}
