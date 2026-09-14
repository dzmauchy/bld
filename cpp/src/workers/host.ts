import { messageId, type WorkerResponse } from "../messages.ts";

type BrowserWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

export type WorkerMessageHandler = (data: unknown) => Promise<WorkerResponse | void>;

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
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function attachWorker(handler: WorkerMessageHandler): void {
  const scope = globalThis as unknown as BrowserWorkerScope;
  scope.onmessage = (event) => {
    void dispatch(event.data, handler, (result) => scope.postMessage(result));
  };
}
