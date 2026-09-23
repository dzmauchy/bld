import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/split-panel/split-panel.js";
import "./theme.css";
import { render } from "@solidjs/web";
import { App } from "./App.js";

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(() => <App />, root);
}
