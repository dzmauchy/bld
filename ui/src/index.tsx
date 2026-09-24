import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/animation/animation.js";
import "@awesome.me/webawesome/dist/components/card/card.js";
import "@awesome.me/webawesome/dist/components/progress-bar/progress-bar.js";
import "@awesome.me/webawesome/dist/components/spinner/spinner.js";
import "@awesome.me/webawesome/dist/components/split-panel/split-panel.js";
import "./theme.css";
import { render } from "@solidjs/web";
import { App } from "./App.js";
import { SplashScreen, WindowLoadClock } from "./view/splash/SplashScreen.js";

const splash = document.querySelector("[data-splash]");
if (splash instanceof HTMLElement) {
  new SplashScreen(splash, new WindowLoadClock()).arm();
}

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(() => <App />, root);
}
