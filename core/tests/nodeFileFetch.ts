import { readFile } from "node:fs/promises";

/**
 * Lets unbundled Node tests fetch the same file URLs the browser loader uses.
 * Node's fetch rejects file URLs, so this adapter answers those requests.
 */
export class NodeFileFetch {
  static install(): void {
    const current = globalThis.fetch;
    if ((current as { nodeFileFetch?: boolean }).nodeFileFetch) return;
    const nativeFetch = current.bind(globalThis);
    const patched = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const href = NodeFileFetch.href(input);
      if (!href.startsWith("file:")) return nativeFetch(input, init);
      try {
        return await nativeFetch(input, init);
      } catch (error) {
        if (!NodeFileFetch.unsupported(error)) throw error;
      }
      return new Response(await readFile(new URL(href)));
    };
    (patched as { nodeFileFetch?: boolean }).nodeFileFetch = true;
    globalThis.fetch = patched;
  }

  private static href(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
  }

  private static unsupported(error: unknown): boolean {
    const texts: string[] = [];
    if (error instanceof Error) {
      texts.push(error.message);
      if (error.cause instanceof Error) texts.push(error.cause.message);
    }
    return texts.some((text) => text.includes("not implemented"));
  }
}

NodeFileFetch.install();
