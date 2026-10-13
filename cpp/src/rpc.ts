import type { WorkerOk, WorkerResponse, WorkerProgress } from "./messages.ts";
import type { Thread } from "./thread.ts";

export class RpcClient {
  private nextId = 1;
  private failure: Error | undefined;
  private readonly pending = new Map<number, {
    resolve: (value: WorkerOk) => void;
    reject: (error: Error) => void;
    progress?: (message: WorkerProgress) => void;
  }>();

  constructor(
    private readonly thread: Thread,
    private readonly onHostMessage?: (message: unknown) => void,
  ) {
    thread.onMessage((message) => this.receive(message));
    thread.onError((error) => this.fail(error));
  }

  async request(payload: Record<string, unknown>, progress?: (message: WorkerProgress) => void): Promise<WorkerOk> {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<WorkerOk>();
    this.pending.set(id, { resolve, reject, ...(progress ? { progress } : {}) });
    try {
      this.thread.postMessage({ ...payload, id });
    } catch (error) {
      this.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  terminate(): Promise<unknown> {
    this.fail(new Error("worker is closed"));
    return this.thread.terminate();
  }

  private receive(message: unknown): void {
    if (message !== null && typeof message === "object" && "id" in message && "type" in message) {
      const response = message as WorkerResponse | WorkerProgress;
      const pending = this.pending.get(response.id);
      if (pending) {
        if (response.type === "progress") {
          pending.progress?.(response);
          return;
        }
        if (response.type === "ok" || response.type === "error") {
          this.pending.delete(response.id);
          if (response.type === "ok") pending.resolve(response);
          else pending.reject(new Error(response.stderr ? `${response.message}\n${response.stderr}` : response.message));
          return;
        }
      }
    }
    this.onHostMessage?.(message);
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export { messageId } from "./messages.ts";
