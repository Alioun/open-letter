import globals from "globals";
export default [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "vendor/**",
      "loadtest/results/**",
      "docs/screenshots/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, Bun: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
];
