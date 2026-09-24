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
import { BrowserClangAstDumper } from "./libraries/browserClangAstDumper.js";
import { SplashScreen } from "./view/splash/SplashScreen.js";

ClangAstDumper.register(BrowserClangAstDumper.shared());

const splash = document.querySelector("[data-splash]");
const splashScreen = splash instanceof HTMLElement ? new SplashScreen(splash, window) : undefined;

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(() => <App onShown={() => splashScreen?.shown()} />, root);
}
