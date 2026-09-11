import { expect, test } from "vitest";
import { AsRuntime } from "./runtime.ts";
import { nodeThread } from "./runtime.node.ts";

test("run worker forwards UI env bindings to the host thread", async () => {
  const pins: unknown[] = [];
  const runtime = new AsRuntime({
    compileThread: nodeThread("compile.worker.ts"),
    runThread: nodeThread("host.run.worker.ts"),
    files: {},
    onHostMessage(message) {
      pins.push(message);
    },
  });
  try {
    const session = await runtime.createSession(`
@external("env", "sendPinF32")
declare function sendPinF32(blockId: i32, pin: i32, value: f32): void;

export function ping(): void {
  sendPinF32(7, 1, 3.5);
}
`);
    await session.call("ping");
    expect(pins).toEqual([{ type: "pin", blockId: 7, pin: 1, value: 3.5 }]);
  } finally {
    await runtime.close();
  }
}, 30_000);
