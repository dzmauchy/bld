import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { target: "es2025" },
  test: {
    projects: ["./runtime", "./core", "./ui", "./cpp"],
  },
});
