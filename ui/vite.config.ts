import { defineConfig } from "vite";
import { isolationHeaders, workspaceAssets } from "./scripts/vitePlugins.ts";

export default defineConfig({
  plugins: [workspaceAssets(true)],
  build: { target: "esnext", assetsInlineLimit: 0, chunkSizeWarningLimit: 750 },
  worker: { format: "es" },
  server: { port: 3001, strictPort: true, headers: isolationHeaders },
  preview: { port: 3001, strictPort: true, headers: isolationHeaders },
});
