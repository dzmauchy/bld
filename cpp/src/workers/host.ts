import { messageId, type WorkerResponse } from "../messages.ts";

type BrowserWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

export type WorkerMessageHandler = (data: unknown) => Promise<WorkerResponse | void>;

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object") {
    const rec = error as { name?: unknown; message?: unknown; status?: unknown; errno?: unknown; code?: unknown };
    const bits = [rec.name, rec.message, rec.status, rec.errno, rec.code]
      .filter((value) => value !== undefined)
      .map(String);
    if (bits.length > 0) return bits.join(": ");
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
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
      message: error instanceof Error ? error.message : formatUnknownError(error),
    });
  }
}

export function attachWorker(handler: WorkerMessageHandler): void {
  const scope = globalThis as unknown as BrowserWorkerScope;
  scope.onmessage = (event) => {
    void dispatch(event.data, handler, (result) => scope.postMessage(result));
  };
}
