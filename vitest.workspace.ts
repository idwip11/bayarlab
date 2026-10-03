import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "packages/providers/*/vitest.config.ts",
  "apps/*/vitest.config.ts",
]);
