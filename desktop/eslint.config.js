// Desktop ESLint flat config (ESM — desktop package is "type": "module").
// react-hooks rules are the machine that would have caught the
// useMemo(() => useSensors(...)) violation that crashed Board on its
// second render (commit bc3ace2) — and DID catch the conditional
// useState after an early return in Dashboard's CompositionPanel.
// Keep react-hooks/rules-of-hooks at 'error'.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'release/**', 'out/**', 'build/**', 'scripts/**']
  },
  js.configs.recommended,
  {
    // Electron main process: plain CJS with Node globals
    files: ['electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['src/**/*.{js,jsx}', 'vitest.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.browser,
        ...globals.es2023
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      // THE crash-class detector. Must stay 'error'.
      'react-hooks/rules-of-hooks': 'error',
      // Legacy codebase: flag missing deps but don't fail CI on them
      'react-hooks/exhaustive-deps': 'warn',
      // React-Compiler-era extra rules: informative only for this codebase
      // (they flag intended pre-compiler patterns); enable during the
      // eventual compiler migration.
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/component-hook-factories': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/config': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/utils/helpers', '../utils/helpers', './utils/helpers'],
              message:
                'helpers.js was moved into @habit-tracker/core — import business logic from there (zero-drift rule)'
            },
            {
              group: ['electron', 'fs', 'path', 'os', 'node:*'],
              message: 'renderer code must not import Node/electron builtins — use window.api'
            }
          ]
        }
      ],
      // Pre-existing hygiene issues are warnings (do not refactor unrelated
      // code per the task ground rules)
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // Test files: keep rules-of-hooks ON — a hook violation in a test is
    // still worth catching.
    files: ['src/__tests__/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.es2023
      }
    },
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
]
