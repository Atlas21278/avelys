import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

// Layer boundaries (ADR-0004): business rules stay free of framework and I/O.
const domainRestrictions = {
  patterns: [
    {
      group: ["@/app/*", "@/server/*", "@/integrations/*"],
      message: "src/domain must stay pure: no app, server or integrations imports.",
    },
    {
      group: ["next", "next/*", "react", "react-dom", "@prisma/*", "stripe", "resend"],
      message: "src/domain must not depend on frameworks, the database or external SDKs.",
    },
  ],
};

const appRestrictions = {
  patterns: [
    {
      group: ["@/integrations/*"],
      message: "src/app must go through src/server services, not call integrations directly.",
    },
  ],
};

// Test-only modules (VTC-023): provisional pricing fixtures must never reach application code.
// Matches `@/domain/pricing/fixtures`, `../pricing/fixtures` and `./fixtures` (inside pricing).
const TEST_FILES = ["src/**/*.test.{ts,tsx}"];
const testOnlyImports = {
  regex: String.raw`(^|/)pricing/fixtures(\.ts)?$|^\./fixtures(\.ts)?$`,
  message: "Pricing fixtures are test-only: import them from *.test.ts files only.",
};

// `no-restricted-imports` options are replaced, not merged, by a later matching block:
// each block lists every pattern that applies to its files.
function restrictImports(...patterns) {
  return { "no-restricted-imports": ["error", { patterns }] };
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    ignores: TEST_FILES,
    rules: restrictImports(testOnlyImports),
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: restrictImports(...domainRestrictions.patterns),
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: restrictImports(...domainRestrictions.patterns, testOnlyImports),
  },
  {
    // Security-relevant randomness (booking references, ADR-0015) comes from node:crypto only.
    files: ["src/domain/**/*.{ts,tsx}", "src/server/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Not cryptographically secure: use randomInt/randomBytes from node:crypto.",
        },
      ],
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: restrictImports(...appRestrictions.patterns),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    rules: restrictImports(...appRestrictions.patterns, testOnlyImports),
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);
