/** The Emscripten FS methods used by the compiler runtime. */
export type EmscriptenFsApi = {
  mount(type: unknown, options: { root: string; fs: unknown }, path: string): unknown;
  mkdirTree(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  chdir(path: string): void;
  analyzePath(path: string): { exists: boolean };
  streams?: StdioStream[];
};

export type EmscriptenModuleOptions = {
  noInitialRun?: boolean;
  noExitRuntime?: boolean;
  thisProgram?: string;
  locateFile?: (path: string, prefix: string) => string;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    receiveInstance: (instance: WebAssembly.Instance) => void,
  ) => unknown;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
};

type StdioStream = {
  tty?: {
    ops?: {
      fsync?: (tty: unknown) => void;
    };
  };
};

export type EmscriptenRuntime = {
  FS: EmscriptenFsApi;
  PROXYFS: unknown;
  callMain: (args: string[]) => number | void;
};

export type EmscriptenModuleFactory = (options?: EmscriptenModuleOptions) => Promise<EmscriptenRuntime>;

/** Loads the released JS factory and compiles its Wasm once; every call creates a fresh heap. */
export async function loadEmscriptenModule(scriptUrl: string, wasmUrl: string): Promise<EmscriptenModuleFactory> {
  const read = async (url: string): Promise<Response> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    return response;
  };
  const [source, compiled] = await Promise.allSettled([
    read(scriptUrl).then(response => response.text()),
    WebAssembly.compileStreaming(read(wasmUrl)),
  ]);
  if (source.status === "rejected") throw source.reason;
  if (compiled.status === "rejected") throw compiled.reason;
  const { default: factory } = await import(/* webpackIgnore: true */
    `data:text/javascript;charset=utf-8,${encodeURIComponent(source.value)}`) as { default: EmscriptenModuleFactory };
  return options => factory({
    ...options,
    instantiateWasm(imports, receiveInstance) {
      const instance = new WebAssembly.Instance(compiled.value, imports);
      receiveInstance(instance);
      return instance.exports;
    },
  });
}
