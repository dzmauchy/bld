/** A host pin write pushed out of the running diagram. */
export class PinSample {
  constructor(
    readonly blockIndex: number,
    readonly channel: number,
    readonly value: number,
  ) {}

  static read(message: unknown): PinSample | undefined {
    if (message === null || typeof message !== "object") return undefined;
    const record = message as { type?: unknown; blockId?: unknown; pin?: unknown; value?: unknown };
    if (record.type !== "pin") return undefined;
    if (typeof record.blockId !== "number" || typeof record.pin !== "number" || typeof record.value !== "number") return undefined;
    if (!Number.isInteger(record.blockId) || record.blockId < 0) return undefined;
    if (!Number.isInteger(record.pin) || record.pin < 0) return undefined;
    if (!Number.isFinite(record.value)) return undefined;
    return new PinSample(record.blockId, record.pin, record.value);
  }
}
