export abstract class Thread {
  abstract postMessage(data: unknown, transfer?: Transferable[]): void;
  abstract onMessage(handler: (data: unknown) => void): void;
  abstract onError(handler: (error: Error) => void): void;
  abstract terminate(): Promise<unknown>;
}

export type EventTargetWorkerLike = {
  postMessage(value: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate(): void;
};

export class EventTargetWorkerThread extends Thread {
  constructor(private readonly worker: EventTargetWorkerLike) {
    super();
  }

  override postMessage(data: unknown, transfer?: Transferable[]): void {
    this.worker.postMessage(data, transfer);
  }

  override onMessage(handler: (data: unknown) => void): void {
    this.worker.addEventListener("message", (event) => handler(event.data));
  }

  override onError(handler: (error: Error) => void): void {
    this.worker.addEventListener("error", (event) => handler(new Error(event.message ?? "worker error")));
  }

  override terminate(): Promise<unknown> {
    return Promise.resolve(this.worker.terminate());
  }
}

export const wrapEventTargetWorker = (worker: EventTargetWorkerLike): Thread => new EventTargetWorkerThread(worker);
