// Root ESLint flat config — covers ROOT-level scripts only.
// Each workspace owns its own config:
//   packages/core/eslint.config.js  — purity (no Node builtins/Electron/React)
//   desktop/eslint.config.js        — react + react-hooks
//   mobile/jest.config.js           — jest (no lint config needed yet)
const globals = require('globals')

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'desktop/**',
      'packages/**',
      'mobile/**',
      'dist/**',
      'release/**',
      'out/**'
    ]
  },
  {
    files: ['**/*.cjs', '**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart']
    }
  }
]
