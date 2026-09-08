import { App } from "./App.js";

const root = document.querySelector("#root");
if (root) {
  root.textContent = App();
}
