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
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", domainRestrictions] },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": ["error", appRestrictions] },
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
