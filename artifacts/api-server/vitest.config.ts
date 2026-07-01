import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The workspace packages (e.g. @workspace/db) expose their TS source via a
    // custom "workspace" export condition; mirror the app's tsconfig here.
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
