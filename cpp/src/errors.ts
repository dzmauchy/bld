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

export function exitStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export function isAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : formatUnknownError(error);
  return /aborted/i.test(message);
}
