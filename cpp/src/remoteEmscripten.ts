import type { EmscriptenModuleFactory, EmscriptenModuleOptions } from "./emscripten.ts";
import { GzipDecoder } from "./gzip.ts";

/**
 * Loads an Emscripten JS glue module and its wasm from remote URLs.
 * The compiled module is kept so later boots do not download the wasm again.
 */
export class RemoteEmscriptenModule {
  private factory: Promise<EmscriptenModuleFactory> | undefined;
  private compiled: Promise<WebAssembly.Module> | undefined;

  constructor(
    private readonly scriptUrl: string,
    private readonly wasmUrl: string,
  ) {}

  createFactory(): EmscriptenModuleFactory {
    return (options) => this.boot(options);
  }

  private async boot(options?: EmscriptenModuleOptions) {
    const [factory, compiled] = await Promise.all([this.factoryOnce(), this.compiledOnce()]);
    return factory({
      ...options,
      instantiateWasm: (imports, receiveInstance) => {
        receiveInstance(new WebAssembly.Instance(compiled, imports));
      },
    });
  }

  private factoryOnce(): Promise<EmscriptenModuleFactory> {
    this.factory ??= this.loadFactory().catch((error: unknown) => {
      this.factory = undefined;
      throw error;
    });
    return this.factory;
  }

  private compiledOnce(): Promise<WebAssembly.Module> {
    this.compiled ??= this.loadCompiled().catch((error: unknown) => {
      this.compiled = undefined;
      throw error;
    });
    return this.compiled;
  }

  private async loadFactory(): Promise<EmscriptenModuleFactory> {
    const source = new TextDecoder().decode(await this.fetchBytes(this.scriptUrl));
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    const loaded = await import(/* webpackIgnore: true */ moduleUrl) as { default: EmscriptenModuleFactory };
    return loaded.default;
  }

  private async loadCompiled(): Promise<WebAssembly.Module> {
    const bytes = await this.fetchWasmBytes(this.wasmUrl);
    return WebAssembly.compile(bytes);
  }

  private async fetchWasmBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    if (!url.endsWith(".gz")) return new Uint8Array(await response.arrayBuffer());
    if (!response.body) throw new Error(`failed to fetch ${url}: empty body`);
    return new GzipDecoder().inflate(response.body);
  }

  private async fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
}
