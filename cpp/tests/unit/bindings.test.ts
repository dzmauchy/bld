import { describe, expect, test } from "vitest";
import { DefaultWasmBindings } from "../../src/bindings.ts";

function uleb(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  do {
    let byte = rest & 0x7f;
    rest >>= 7;
    if (rest) byte |= 0x80;
    bytes.push(byte);
  } while (rest);
  return bytes;
}

function section(id: number, body: number[]): number[] {
  return [id, ...uleb(body.length), ...body];
}

function vec(items: number[][]): number[] {
  return [...uleb(items.length), ...items.flat()];
}

function name(value: string): number[] {
  const bytes = [...value].map((char) => char.charCodeAt(0));
  return [...uleb(bytes.length), ...bytes];
}

function moduleBytes(extraEnv?: string): ArrayBuffer {
  const type = [0x60, 2, 0x7f, 0x7f, 1, 0x7f];
  const imports = [
    [...name("env"), ...name("host_add"), 0x00, 0],
    [...name("wasi_snapshot_preview1"), ...name("args_sizes_get"), 0x00, 0],
  ];
  if (extraEnv) imports.push([...name("env"), ...name(extraEnv), 0x00, 0]);
  const functions = extraEnv ? [] : [0, 0];
  const parts = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([type])),
    ...section(2, vec(imports)),
  ];
  if (!extraEnv) {
    const run = [0x00, 0x41, 0x02, 0x41, 0x03, 0x10, 0x00, 0x0b];
    const argc = [0x00, 0x41, 0x00, 0x41, 0x04, 0x10, 0x01, 0x0b];
    parts.push(
      ...section(3, [...uleb(functions.length), ...functions]),
      ...section(5, [0x01, 0x00, 0x01]),
      ...section(7, vec([
        [...name("memory"), 0x02, 0],
        [...name("run"), 0x00, 2],
        [...name("argc"), 0x00, 3],
      ])),
      ...section(10, vec([
        [...uleb(run.length), ...run],
        [...uleb(argc.length), ...argc],
      ])),
    );
  }
  const bytes = new Uint8Array(parts);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("browser emscripten embedder", () => {
  test("provides host env functions and the standalone libc syscall imports", async () => {
    const module = await WebAssembly.compile(moduleBytes());
    const bindings = DefaultWasmBindings.open({
      sendPinF32: () => {},
    });
    const instance = await bindings.instantiate(module);
    const run = instance.exports["run"];
    const argc = instance.exports["argc"];
    expect(typeof run).toBe("function");
    expect(typeof argc).toBe("function");
    expect((run as () => number)()).toBe(5);
    expect((argc as () => number)()).toBe(0);
  });

  test("stubs a function import the embedder does not implement", async () => {
    const module = await WebAssembly.compile(moduleBytes("missing"));
    const bindings = DefaultWasmBindings.open();
    await expect(bindings.instantiate(module)).resolves.toBeInstanceOf(WebAssembly.Instance);
  });
});
