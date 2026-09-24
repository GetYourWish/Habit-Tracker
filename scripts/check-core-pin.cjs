#!/usr/bin/env node
// Drift guard: both apps must pin @habit-tracker/core to the EXACT
// same version as packages/core itself (no ^, ~, * or workspace ranges).
// Any change to scoring/schema/fixtures REQUIRES a core version bump, so a
// version mismatch means the two apps could compute different numbers from
// the same habit.json. CI fails on any of those conditions.
'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const CORE_PKG = path.join(root, 'packages', 'core', 'package.json')
const APPS = ['desktop', 'mobile']

const core = JSON.parse(fs.readFileSync(CORE_PKG, 'utf8')).version

const EXACT = /^\d+\.\d+\.\d+$/
let failed = false

for (const app of APPS) {
  const pkgPath = path.join(root, app, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    console.error(`drift-guard FAIL: ${app}/package.json missing`)
    failed = true
    continue
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const dep = (pkg.dependencies && pkg.dependencies['@habit-tracker/core'])
  const name = `${app}/package.json`

  if (dep === undefined) {
    console.error(`drift-guard FAIL: ${name} does not depend on @habit-tracker/core`)
    failed = true
    continue
  }
  if (!EXACT.test(dep)) {
    console.error(
      `drift-guard FAIL: ${name} pins "@habit-tracker/core": "${dep}" — must be an EXACT version (no ^ ~ *)`
    )
    failed = true
    continue
  }
  if (dep !== core) {
    console.error(
      `drift-guard FAIL: ${name} pins core ${dep} but packages/core is ${core} — bump the pin (a core change is breaking)`
    )
    failed = true
    continue
  }
  console.log(`drift-guard OK: ${name} pins @habit-tracker/core ${dep} (exact)`)
}

if (!EXACT.test(core)) {
  console.error(`drift-guard FAIL: packages/core version "${core}" is not a fixed x.y.z`)
  failed = true
}

if (failed) process.exit(1)
console.log('drift-guard OK: core is pinned identically everywhere at', core)
