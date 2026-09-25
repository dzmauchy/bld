import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { target: "es2025" },
  test: {
    projects: ["./runtime", "./core", "./ui", "./cpp"],
  },
});
