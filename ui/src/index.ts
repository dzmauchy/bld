import "@awesome.me/webawesome/dist/styles/webawesome.css";
import "@awesome.me/webawesome/dist/components/split-panel/split-panel.js";
import "./theme.css";
import { render } from "solid-js/web";
import { App } from "./App.js";

const root = document.querySelector("#root");
if (root instanceof HTMLElement) {
  render(() => new App().element, root);
}
