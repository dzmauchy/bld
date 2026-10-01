import { expect, test } from "@rstest/core";
import { SharedToolchainFileSystem } from "../../src/sharedFileSystem.ts";
import type { WorkerResponse } from "../../src/messages.ts";
import { attachWorker } from "../../src/workers/host.ts";

test("transfers compiler output to the host without detaching shared filesystem storage", async () => {
  const files = new SharedToolchainFileSystem();
  files.writeTree("/work/a.wasm", new Uint8Array([0, 97, 115, 109]));
  const output = files.readFile("/work/a.wasm");
  const delivered = Promise.withResolvers<WorkerResponse>();
  const savedMessage = Object.getOwnPropertyDescriptor(globalThis, "onmessage");
  const savedPost = Object.getOwnPropertyDescriptor(globalThis, "postMessage");
  const scope = globalThis as unknown as {
    onmessage: (event: { data: unknown }) => void;
    postMessage: (response: WorkerResponse, transfer: Transferable[]) => void;
  };
  Object.defineProperty(globalThis, "postMessage", {
    configurable: true,
    value: (response: WorkerResponse, transfer: Transferable[]) => {
      expect(transfer).toEqual([output.buffer]);
      delivered.resolve(structuredClone(response, { transfer }));
    },
  });
  try {
    attachWorker(async () => ({ id: 1, type: "ok", files: { "/work/a.wasm": output } }));
    scope.onmessage({ data: { id: 1, type: "compile" } });
    expect(await delivered.promise).toMatchObject({ files: { "/work/a.wasm": new Uint8Array([0, 97, 115, 109]) } });
    expect(output.byteLength).toBe(0);
    expect(files.readFile("/work/a.wasm")).toEqual(new Uint8Array([0, 97, 115, 109]));
  } finally {
    if (savedMessage) Object.defineProperty(globalThis, "onmessage", savedMessage);
    else Reflect.deleteProperty(globalThis, "onmessage");
    if (savedPost) Object.defineProperty(globalThis, "postMessage", savedPost);
    else Reflect.deleteProperty(globalThis, "postMessage");
  }
});
