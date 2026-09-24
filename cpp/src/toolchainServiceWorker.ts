/** Claims the page so compiler-worker fetches of the llvm-project release succeed. */
export class ToolchainServiceWorker {
  static readonly script = "/llvm-toolchain-sw.js";

  async claim(): Promise<void> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const controlled = new Promise<void>((resolve) => {
      if (navigator.serviceWorker.controller) {
        resolve();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
    await navigator.serviceWorker.register(ToolchainServiceWorker.script, { scope: "/" });
    await controlled;
  }
}
