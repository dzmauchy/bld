const releasePrefix = "https://github.com/dzmauchy/llvm-project/releases/download/clang-lld-wasm-latest/";
const releaseFiles = new Set(["clang.js", "clang.wasm.gz", "lld.js", "lld.wasm.gz", "sysroot.tgz"]);

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = event.request.url;
  if (!requestUrl.startsWith(releasePrefix)) return;
  const name = requestUrl.slice(releasePrefix.length);
  if (!releaseFiles.has(name)) return;
  event.respondWith(relayReleaseAsset(requestUrl, name));
});

async function relayReleaseAsset(requestUrl, name) {
  const relay = new URL("/llvm-toolchain-proxy", self.location.origin);
  relay.searchParams.set("url", requestUrl);
  const upstream = await fetch(relay.href);
  const type = name.endsWith(".js") ? "text/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/gzip";
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: {
      "content-type": type,
      "cache-control": "private, max-age=3600",
    },
  });
}
