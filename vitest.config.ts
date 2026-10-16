import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so the React Router plugin doesn't load in tests.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
