// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    ignores: ["dist/*"],
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx", ".json"],
        },
      },
    },
    rules: {
      // React Compiler diagnostics added by eslint-config-expo 57. Both are
      // advisory rather than correctness rules: set-state-in-effect flags our
      // pre-existing "reset derived UI state when upstream props change"
      // effects, and preserve-manual-memoization just means the compiler
      // leaves already-correct manual useMemo/useCallback as-is.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);
