import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["./runtime", "./base", "./core", "./ui"],
  },
});
