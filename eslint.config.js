import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'backend'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Layering rule (docs/architecture/v2-plan.md §G): components only reach the
      // API through hooks/, never api/ directly.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/api/*', '!@/api/errors'],
              message:
                'Import API modules through a hook in src/hooks/, not directly from a component.',
            },
          ],
        },
      ],
    },
  },
  {
    // src/lib/http/ is the adapter layer that maps the typed api/ modules onto
    // the domain ports (WordsBackend); like hooks/, it sits between components
    // and api/ rather than being the component code the rule above guards.
    files: ['src/hooks/**/*.{ts,tsx}', 'src/api/**/*.{ts,tsx}', 'src/lib/http/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Context modules deliberately co-locate a Provider component with its
    // consumer hook (e.g. AuthProvider + useAuth) — the standard React
    // context idiom. That trips react-refresh's "only export components"
    // heuristic, which is about dev-server hot-reload boundaries, not
    // correctness. Splitting each into two files to silence it would be
    // exactly the kind of premature abstraction this project is trying to
    // avoid, so the rule is scoped off for these files only.
    files: ['src/context/**/*.tsx', 'src/components/ui/Toast.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  prettier,
)
