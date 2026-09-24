// Metro config — resolve an npm-workspaces monorepo (Expo's documented setup):
// 1. watch the workspace root so edits inside packages/core trigger reloads
// 2. look up hoisted modules in <root>/node_modules as well as ./node_modules
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
]

// RN 0.87 removed the `react-native/rn-get-polyfills` entry point that
// @expo/metro-config still resolves; the polyfill list moved to the
// @react-native/js-polyfills package. Use it when the legacy file is gone —
// same two polyfills (console, error-guard) the legacy file returned.
let getPolyfills
try {
  require.resolve('react-native/rn-get-polyfills')
  getPolyfills = undefined // stock expo path still works
} catch (e) {
  const rnPolyfills = require('@react-native/js-polyfills')
  getPolyfills = ({ platform }) => (platform ? rnPolyfills() : [])
}
if (getPolyfills) {
  config.serializer.getPolyfills = getPolyfills
}

module.exports = config
