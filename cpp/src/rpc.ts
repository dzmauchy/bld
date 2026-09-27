import { messageId, type WorkerOk, type WorkerResponse } from "./messages.ts";
import type { Thread } from "./thread.ts";

function isWorkerResponse(message: unknown): message is WorkerResponse {
  return (
    message !== null &&
    typeof message === "object" &&
    "id" in message &&
    "type" in message &&
    ((message as WorkerResponse).type === "ok" || (message as WorkerResponse).type === "error")
  );
}

function collectTransferables(value: unknown, into: Transferable[]): void {
  if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) {
    into.push(value.buffer);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTransferables(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectTransferables(item, into);
  }
}

export class RpcClient {
  private nextId = 1;
  private failure: Error | undefined;
  private readonly pending = new Map<number, {
    resolve: (value: WorkerResponse) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly thread: Thread) {
    this.thread.onMessage((message) => {
      if (!isWorkerResponse(message)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      pending.resolve(message);
    });
    this.thread.onError((error) => {
      this.fail(error);
    });
  }

  async request(payload: Record<string, unknown>, transfer = false): Promise<WorkerOk> {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<WorkerResponse>();
    this.pending.set(id, { resolve, reject });
    const message = { ...payload, id };
    try {
      if (transfer) {
        const buffers: Transferable[] = [];
        collectTransferables(message, buffers);
        this.thread.postMessage(message, buffers);
      } else {
        this.thread.postMessage(message);
      }
    } catch (error) {
      this.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    const response = await promise;
    if (response.type === "error") {
      throw new Error(response.stderr ? `${response.message}\n${response.stderr}` : response.message);
    }
    return response;
  }

  terminate(): Promise<unknown> {
    this.fail(new Error("worker is closed"));
    return this.thread.terminate();
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export { messageId };
