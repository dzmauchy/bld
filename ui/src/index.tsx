import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/animation/animation.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/split-panel/split-panel.js";
import "./theme.css";
import { ClangAstDumper } from "core";
import { render } from "@solidjs/web";
import { App } from "./App.js";
import { ToolchainServiceWorker } from "cpp";
import { BrowserClangAstDumper } from "./libraries/browserClangAstDumper.js";
import { BldSplash } from "./view/splash/BldSplash.js";

await new ToolchainServiceWorker().claim();
ClangAstDumper.register(BrowserClangAstDumper.shared());

const splash = document.querySelector(BldSplash.tagName);
const splashScreen = splash instanceof BldSplash ? splash : undefined;

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(() => <App onShown={() => splashScreen?.shown()} />, root);
}
