import { messageId, type WorkerResponse } from "./messages.ts";

export type WorkerMessageHandler = (data: unknown) => Promise<WorkerResponse | void>;

type ParentPort = {
  postMessage: (value: unknown) => void;
  on: (event: "message", listener: (value: unknown) => void) => void;
};

type BrowserWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown) => void;
};

function nodeParentPort(): ParentPort | null {
  const processRef = (
    globalThis as {
      process?: { getBuiltinModule?: (id: string) => { parentPort?: ParentPort | null } };
    }
  ).process;
  const threads = processRef?.getBuiltinModule?.("worker_threads");
  return threads?.parentPort ?? null;
}

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

/** Attach a request handler in a Node worker_threads worker or a browser Worker. */
export function attachWorker(handler: WorkerMessageHandler): void {
  const parentPort = nodeParentPort();
  if (parentPort) {
    parentPort.on("message", (data) => {
      void dispatch(data, handler, (result) => parentPort.postMessage(result));
    });
    return;
  }
  const scope = globalThis as unknown as BrowserWorkerScope;
  scope.onmessage = (event) => {
    void dispatch(event.data, handler, (result) => scope.postMessage(result));
  };
}
