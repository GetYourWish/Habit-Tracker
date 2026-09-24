// Purity enforcement for @habit-tracker/core.
// The package must run identically under Node (Electron/Vitest) and
// Hermes/React Native (Jest + jest-expo). Anything platform-specific is
// forbidden here — it belongs in the apps or in the allowed dependencies.
const globals = require('globals')

const FORBIDDEN_IMPORTS = {
  paths: [
    // Node builtins & runtime
    { name: 'fs', message: 'core must not import Node builtins' },
    { name: 'path', message: 'core must not import Node builtins' },
    { name: 'os', message: 'core must not import Node builtins' },
    { name: 'util', message: 'core must not import Node builtins' },
    { name: 'crypto', message: 'core must not import Node builtins (use the uuid dependency)' },
    { name: 'child_process', message: 'core must not import Node builtins' },
    { name: 'http', message: 'core must not import Node builtins' },
    { name: 'https', message: 'core must not import Node builtins' },
    { name: 'net', message: 'core must not import Node builtins' },
    { name: 'url', message: 'core must not import Node builtins' },
    { name: 'stream', message: 'core must not import Node builtins' },
    { name: 'zlib', message: 'core must not import Node builtins' },
    { name: 'electron', message: 'core must not import Electron' },
    // UI / platform frameworks
    { name: 'react', message: 'core must not import React' },
    { name: 'react-dom', message: 'core must not import React DOM' },
    { name: 'react-native', message: 'core must not import React Native' },
    { name: 'expo', message: 'core must not import Expo' },
    { name: 'expo-file-system', message: 'core must not import Expo modules' },
    { name: '@dnd-kit/core', message: 'core must not import UI libraries' },
    { name: 'recharts', message: 'core must not import UI libraries' },
    { name: 'framer-motion', message: 'core must not import UI libraries' },
    { name: 'html-to-image', message: 'core must not import UI libraries' }
  ],
  patterns: [
    {
      group: ['node:*'],
      message: 'core must not import Node builtins'
    },
    {
      group: ['electron/**', 'react-native/**', 'expo/**', '@expo/**'],
      message: 'core must not import platform frameworks'
    }
  ]
}

const FORBIDDEN_GLOBALS = [
  { name: 'process', message: 'core must not read process (env/platform detection)' },
  { name: 'Buffer', message: 'core must not use Buffer' },
  { name: 'window', message: 'core must not touch the DOM/window' },
  { name: 'document', message: 'core must not touch the DOM' },
  { name: 'navigator', message: 'core must not touch navigator' },
  { name: 'fetch', message: 'core must not perform network I/O' },
  { name: 'localStorage', message: 'core must not touch storage' }
]

module.exports = [
  {
    ignores: ['node_modules/**', '__fixtures__/**', 'coverage/**']
  },
  {
    files: ['index.js', 'src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.commonjs
      }
    },
    rules: {
      'no-restricted-imports': ['error', FORBIDDEN_IMPORTS],
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
      eqeqeq: ['error', 'smart'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    // Test tooling (this folder) runs in Node and MAY use fs/path to load
    // fixtures — the purity contract applies to shipped package code only.
    files: ['tests/**', 'scripts/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.commonjs,
        ...globals.node
      }
    },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off'
    }
  },
  {
    // ESM test files (Vitest wrappers + unit tests use import/export)
    files: ['tests/*.test.js', 'tests/*.test.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.commonjs,
        ...globals.node
      }
    },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off'
    }
  }
]
