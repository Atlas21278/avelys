import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
// Tests run outside the React Server environment: the "server-only" guard is a no-op here.
const serverOnlyStub = fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url));

// Integration tests use the dedicated test database (docker compose, or the CI service).
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://avelys:avelys_local@127.0.0.1:5433/avelys_test";

export default defineConfig({
  resolve: {
    alias: { "@": src, "server-only": serverOnlyStub },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/generated/**"],
      reporter: ["text", "lcov"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts"],
          env: {
            APP_ENV: "ci",
            APP_URL: "http://localhost:3000",
            DATABASE_URL: TEST_DATABASE_URL,
            // Fixed, test-only value (not a secret): signs cookies of the test database only.
            BETTER_AUTH_SECRET: "integration-tests-only-placeholder-not-a-secret",
            LOG_LEVEL: "silent",
          },
          fileParallelism: false,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
