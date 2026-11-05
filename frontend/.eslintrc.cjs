module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: ["eslint:recommended", "plugin:react/recommended", "plugin:react-hooks/recommended"],
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  settings: { react: { version: "detect" } },
  rules: {
    "react/prop-types": "off", // Not using PropTypes in this MVP; consider TypeScript migration instead of PropTypes for a growing codebase.
    "react/react-in-jsx-scope": "off", // Vite's JSX runtime handles this automatically.
  },
};
