import type { IncomingMessage, ServerResponse } from "node:http";

const releasePrefix = "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/";
const releaseFiles = new Set(["clang.js", "clang.wasm", "lld.js", "lld.wasm"]);

type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

type MiddlewareHost = {
  use(fn: ConnectMiddleware): void;
};

export function attachLlvmToolchainProxy(middlewares: MiddlewareHost): void {
  middlewares.use((req, res, next) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/llvm-toolchain-proxy") {
      next();
      return;
    }
    const target = url.searchParams.get("url") ?? "";
    const name = target.startsWith(releasePrefix) ? target.slice(releasePrefix.length) : "";
    if (!releaseFiles.has(name)) {
      res.statusCode = 403;
      res.end("forbidden toolchain url");
      return;
    }
    void fetch(target).then(async (response) => {
      res.statusCode = response.status;
      res.setHeader("content-type", name.endsWith(".js") ? "text/javascript" : "application/wasm");
      res.setHeader("cache-control", "private, max-age=3600");
      res.end(Buffer.from(await response.arrayBuffer()));
    }).catch(next);
  });
}
