import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "work/**",
    "outputs/**",
    ".npm-cache/**",
    ".aws/**",
    "data/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
