import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "dist-nosplit/", "node_modules/", "scripts/", "*.cjs", "coverage/"] },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 引入的 Compiler 时代规则: 本项目有几处刻意的既定模式
      // (sync hook 在渲染期读 ref 发布 ready、storage 同步 effect 里 setState),
      // 行为均有测试覆盖; 重写风险大于收益, 关闭并保留 rules-of-hooks/exhaustive-deps。
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: ["**/*.test.mjs", "**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
