import { formatUnknownError } from "../errors.ts";
import { messageId, type WorkerResponse } from "../messages.ts";

type BrowserWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

export type WorkerMessageHandler = (data: unknown) => Promise<WorkerResponse | void>;

export { formatUnknownError };

async function dispatch(
  data: unknown,
  handler: WorkerMessageHandler,
  post: (result: WorkerResponse) => void,
): Promise<void> {
  try {
    const result = await Promise.resolve(handler(data));
    if (result) post(result);
  } catch (error) {
    post({
      id: messageId(data),
      type: "error",
      message: error instanceof Error ? error.message : formatUnknownError(error),
    });
  }
}

/** Serializes requests that share a tool runtime and its mutable filesystem. */
export class WorkerMessageDispatcher {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly handler: WorkerMessageHandler,
    private readonly post: (result: WorkerResponse) => void,
  ) {}

  dispatch(data: unknown): Promise<void> {
    const result = this.pending.then(() => dispatch(data, this.handler, this.post));
    this.pending = result.catch(() => {});
    return result;
  }
}

export function attachWorker(handler: WorkerMessageHandler): void {
  const scope = globalThis as unknown as BrowserWorkerScope;
  const dispatcher = new WorkerMessageDispatcher(handler, (result) => {
    const buffers = new Set<ArrayBuffer>();
    if (result.type === "ok") {
      for (const file of Object.values(result.files ?? {})) {
        if (file.buffer instanceof ArrayBuffer) buffers.add(file.buffer);
      }
    }
    // Compiler results are owned copies; transferring them leaves shared files intact.
    scope.postMessage(result, [...buffers]);
  });
  scope.onmessage = (event) => {
    void dispatcher.dispatch(event.data);
  };
}
