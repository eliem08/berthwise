import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/__tests__/**/*.test.ts"],
    // The planner/solver property tests run multi-second metaheuristic
    // searches; under parallel workers (vitest >= 4 scheduling) the 5s default
    // produced load-induced timeouts, not logic failures.
    testTimeout: 60_000,
  },
});
