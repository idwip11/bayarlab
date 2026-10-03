import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // These integration specs launch several Node processes; allow CI startup overhead.
    // Delivery timeouts and max-duration assertions remain independently enforced.
    testTimeout: 30_000,
  },
});
