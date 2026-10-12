import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/animation/animation.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/split-panel/split-panel.js";
import "./theme.css";
import { html, render } from "lit";
import "./App.js";
import { BrowserClangAstDumper, BrowserCppRuntime, ClangAstDumper, ToolchainServiceWorker } from "cpp";
import { BldSplash } from "./view/splash/BldSplash.js";

await new ToolchainServiceWorker().claim();
// Start downloading and compiling clang/lld while the workspace loads. Both
// diagram analysis and Run await this promise through the shared compiler.
// A failed preload is retried by the next job, which reports its own error.
void BrowserCppRuntime.shared().prepareCompiler().catch(() => {});
ClangAstDumper.register(BrowserClangAstDumper.shared());

const splash = document.querySelector(BldSplash.tagName);
const splashScreen = splash instanceof BldSplash ? splash : undefined;

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(html`<bld-app .onShown=${() => splashScreen?.shown()}></bld-app>`, root);
}
