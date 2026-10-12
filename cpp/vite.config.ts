import { defineConfig } from "vite";
import { isolationHeaders, workspaceAssets } from "../ui/scripts/vitePlugins.ts";

export default defineConfig({
  plugins: [workspaceAssets()],
  build: { outDir: "dist/web", target: "esnext", assetsInlineLimit: 0 },
  worker: { format: "es" },
  server: { port: 3002, strictPort: true, headers: isolationHeaders },
  preview: { port: 3002, strictPort: true, headers: isolationHeaders },
});
