// jest-expo 57 requires @react-native/jest-preset ^0.86.3. Pin the preset to
// that compatible release so a clean `npm install` can resolve the workspace
// without --legacy-peer-deps or --force.

const fs = require('fs')
const path = require('path')

const mobileRoot = path.join(__dirname, '..')
const repoRoot = path.join(mobileRoot, '..')

describe('jest-expo dependency contract', () => {
  test('the mobile Jest preset satisfies jest-expo 57 peer dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'))

    expect(pkg.devDependencies['@react-native/jest-preset']).toBe('0.86.3')
    expect(pkg.devDependencies['jest-expo']).toBe('57.0.5')
    expect(lock.packages.mobile.devDependencies['@react-native/jest-preset']).toBe('0.86.3')
    expect(lock.packages['node_modules/@react-native/jest-preset'].version).toBe('0.86.3')
  })
})
