import { describe, expect, test } from "vitest";
import { browserProfile, getWasmProfile, mcuProfile } from "runtime";

describe("wasm profiles", () => {
  test("resolves browser and mcu profiles", () => {
    expect(getWasmProfile("browser")).toBe(browserProfile);
    expect(getWasmProfile("mcu")).toBe(mcuProfile);
    expect(getWasmProfile(browserProfile)).toBe(browserProfile);
  });

  test("rejects unknown profile names", () => {
    expect(() => getWasmProfile("fpga" as "browser")).toThrow(/Unknown wasm profile "fpga"/);
  });
});
