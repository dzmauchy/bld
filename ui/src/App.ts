import { add } from "core";
import { modelAssets } from "./modelAssets.js";

function firstTitle(source: string): string {
  return source.match(/@title\s+(.+)/)?.[1]?.trim() ?? "";
}

export function App(): string {
  const lines = [String(add(2, 2))];
  for (const name of Object.keys(modelAssets).sort()) {
    const title = firstTitle(modelAssets[name as keyof typeof modelAssets]);
    lines.push(title ? `${name} ${title}` : name);
  }
  return lines.join("\n");
}
