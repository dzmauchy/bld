import { add } from "core";

export function App(): string {
  return String(add(2, 2));
}

const root = document.querySelector("#root");
if (root) {
  root.textContent = App();
}
