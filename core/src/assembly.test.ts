import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import asc from "assemblyscript/asc";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const assemblyDir = join(coreRoot, "assets/assembly");
const blocksPath = join(coreRoot, "assets/blocks.json");
const typesPath = join(coreRoot, "assets/types.json");

const BLOCK_CLASSES: Record<string, string> = {
  cos_f32: "CosF32",
  sin_f32: "SinF32",
  scope_f32: "ScopeF32",
  product_f32: "ProductF32",
  gpio_in: "GpioIn",
  const_f32: "ConstF32",
  cos_gen_f32: "CosGenF32",
  sin_gen_f32: "SinGenF32",
  rand_gen_f32: "RandGenF32",
  pulse_gen_f32: "PulseGenF32",
};

function assemblySources(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === "tests" || name.name === "build") continue;
        walk(path);
      } else if (name.name.endsWith(".ts")) {
        files.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(assemblyDir);
  return files.join("\n");
}

describe("assemblyscript assets match catalog", () => {
  test("every blocks.json entry has a class", () => {
    const catalog = JSON.parse(readFileSync(blocksPath, "utf8")) as Record<string, unknown>;
    const ids = Object.keys(catalog).filter((key) => key !== "$schema");
    expect(ids.sort()).toEqual(Object.keys(BLOCK_CLASSES).sort());
    const source = assemblySources();
    for (const [id, className] of Object.entries(BLOCK_CLASSES)) {
      expect(source, id).toContain(`class ${className} `);
    }
  });

  test("types.json primitives are AssemblyScript builtins or aliases", () => {
    const catalog = JSON.parse(readFileSync(typesPath, "utf8")) as Record<string, unknown>;
    const ids = Object.keys(catalog).filter((key) => key !== "$schema");
    expect(ids).toEqual(
      expect.arrayContaining([
        "bool",
        "i8",
        "u8",
        "i16",
        "u16",
        "i32",
        "u32",
        "i64",
        "u64",
        "f32",
        "f64",
        "pss",
        "array",
      ]),
    );
    const typesSource = readFileSync(join(assemblyDir, "types.ts"), "utf8");
    expect(typesSource).toContain("export interface Pss<T>");
    expect(typesSource).toContain("export type Arr<T>");
    expect(typesSource).toContain("export interface F32PushStream");
  });
});

const compiled = await compileAssemblyTests();

describe("assemblyscript pin tests", () => {
  test("compiled wasm exports pin tests", () => {
    expect(compiled.tests.length).toBeGreaterThan(40);
  });

  for (const name of compiled.tests) {
    test(name, () => {
      compiled.run(name);
    });
  }
});

async function compileAssemblyTests(): Promise<{
  tests: string[];
  run(name: string): void;
}> {
  const files = new Map<string, Uint8Array | string>();
  const result = await asc.main(
    [
      "tests/index.ts",
      "--baseDir",
      assemblyDir,
      "--config",
      "asconfig.json",
      "--outFile",
      "build/tests.wasm",
      "--textFile",
      "build/tests.wat",
      "--debug",
      "--exportRuntime",
    ],
    {
      writeFile(filename, contents) {
        files.set(filename.replace(/\\/g, "/"), contents);
      },
    },
  );

  if (result.error) {
    throw new Error(`${result.stderr.toString()}\n${result.error.message}`);
  }

  const wasm = files.get("build/tests.wasm");
  if (!(wasm instanceof Uint8Array)) {
    throw new Error(`AssemblyScript emit missing wasm. files=${[...files.keys()].join(",")}`);
  }

  const { instance } = await WebAssembly.instantiate(wasm, {
    env: {
      abort(_msg: number, _file: number, line: number, column: number) {
        throw new Error(`AssemblyScript abort at ${line}:${column}`);
      },
      seed() {
        return 1;
      },
    },
  });

  const tests = Object.keys(instance.exports)
    .filter((name) => name.startsWith("test_"))
    .sort();

  return {
    tests,
    run(name: string) {
      const fn = instance.exports[name];
      if (typeof fn !== "function") {
        throw new Error(`missing export ${name}`);
      }
      fn();
    },
  };
}
