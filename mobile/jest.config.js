module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  // Node core module used by the fixture contract (fs to load fixtures —
  // test tooling only; the core package itself stays pure)
  testEnvironment: 'node',
  // npm workspaces: some deps (e.g. react-native-reanimated) are nested in
  // mobile/node_modules while their importers (draggable-flatlist) live in
  // the ROOT node_modules. Metro handles this for device bundles; teach
  // jest-resolve both trees so the full app graph can mount under jest.
  modulePaths: ['<rootDir>/node_modules', '<rootDir>/../node_modules']
}

