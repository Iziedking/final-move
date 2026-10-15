import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// @next/eslint-plugin-next is an optional peer dep – import it only if present
// so the monorepo root config doesn't hard-require it for non-Next packages.
let nextPlugin = null;
try {
  nextPlugin = (await import("@next/eslint-plugin-next")).default;
} catch {
  // package not installed at root – Next rules only apply inside apps/web
}

export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      ...(nextPlugin ? { "@next/next": nextPlugin } : {}),
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // Next.js rules – only active when the plugin loaded
      ...(nextPlugin ? nextPlugin.configs?.["core-web-vitals"]?.rules ?? {} : {}),
    },
  },
  // Exclude Next.js img rule for ProfileClient (it intentionally uses <img> for
  // external OAuth avatars where next/image would need a domain allow-list).
  {
    files: ["apps/web/src/components/ProfileClient.tsx"],
    rules: {
      "@next/next/no-img-element": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "vendor/**",
      "**/dist/**",
      "packages/contracts/**",
      "packages/ui/src/ChessBoard.reference.tsx",
      "scripts/**",
      "vitest.config.ts",
      // apps/web has its own .eslintrc.json (extends next/core-web-vitals) so
      // next build uses it directly.  Exclude from the root flat config to avoid
      // running two conflicting rule sets and the "Next.js plugin not detected"
      // warning that fires when the flat config is used instead of .eslintrc.json.
      "apps/web/**",
    ],
  },
];
