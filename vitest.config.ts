import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    globals: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "lib/**/*.ts",
        "app/api/**/*.ts",
        "components/**/*.tsx",
      ],
      // Canvas-heavy / animation components don't carry meaningful unit
      // assertions; pages are e2e-tested. Coverage focuses on pure logic.
      exclude: [
        "**/*.d.ts",
        "node_modules/**",
        "components/HeroPond.tsx",
        "components/CursorSpotlight.tsx",
        "components/ScrollProgress.tsx",
      ],
    },
  },
});
