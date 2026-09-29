#!/usr/bin/env node
'use strict'

/**
 * Generate the Android project and build an installable release APK.
 *
 * Expo's managed workflow intentionally does not commit android/. This command
 * makes the required generation step part of the APK build, so callers do not
 * need to enter a directory that has not been created yet.
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const mobileRoot = path.resolve(__dirname, '..')
const androidRoot = path.join(mobileRoot, 'android')
const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
const wrapperPath = path.join(androidRoot, wrapperName)
const releaseApk = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) {
    console.error(`[build-android-apk] failed to start ${command}: ${result.error.message}`)
    return 1
  }
  return result.status === null ? 1 : result.status
}

function main() {
  console.log('[build-android-apk] generating mobile/android with Expo prebuild...')
  const prebuildStatus = run(process.execPath, ['scripts/expo-prebuild-safe.js'], { cwd: mobileRoot })
  if (prebuildStatus !== 0) return prebuildStatus

  if (!fs.existsSync(wrapperPath)) {
    console.error(`[build-android-apk] prebuild finished but ${wrapperName} was not generated at ${wrapperPath}`)
    return 1
  }

  console.log('[build-android-apk] assembling the release APK...')
  const assembleStatus = run(wrapperPath, ['assembleRelease'], {
    cwd: androidRoot,
    shell: process.platform === 'win32'
  })
  if (assembleStatus !== 0) return assembleStatus

  if (!fs.existsSync(releaseApk)) {
    console.error(`[build-android-apk] Gradle completed but no APK was found at ${releaseApk}`)
    return 1
  }

  console.log(`[build-android-apk] APK ready: ${releaseApk}`)
  return 0
}

if (require.main === module) process.exitCode = main()

module.exports = { androidRoot, wrapperName, wrapperPath, releaseApk, main }
