import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "data/**",
    "next-env.d.ts",
    // Downloaded ui2v source packages are audit fixtures, not project source.
    "motions/**",
    ".ui2v/**",
    // Remotion probe output contains generated bundles and media.
    ".tmp-animation-probe/**",
  ]),
]);

export default eslintConfig;
