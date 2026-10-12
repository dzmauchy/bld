import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { projects: ["core/vitest.config.ts", "ui/vitest.config.ts", "cpp/vitest.config.ts"] },
});
