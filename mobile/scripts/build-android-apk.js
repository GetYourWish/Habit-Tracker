#!/usr/bin/env node
'use strict'

/**
 * Generate the Android project and build an installable release APK.
 *
 * Expo's managed workflow intentionally does not commit android/. This command
 * makes the required generation step part of the APK build, so callers do not
 * need to enter a directory that has not been created yet.
 *
 * Naming (user request 2026-10-10): the finished APK is copied to the repo
 * root as "HabitTracker-v<version>.apk" — a clean file name with no "-debug"
 * or Gradle boilerplate in it. The app itself is always installed on the phone
 * under the plain name "Habit Tracker": every variant now shares the same
 * launcher label (see plugins/with-standalone-release.js).
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const mobileRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(mobileRoot, '..')
const androidRoot = path.join(mobileRoot, 'android')
const wrapperName = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
const wrapperPath = path.join(androidRoot, wrapperName)
const releaseApk = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')

/**
 * Read expo.version from mobile/app.json for the friendly output name.
 * Falls back to 'unknown' — never fails the build over a label.
 */
function readAppVersion() {
  try {
    const appJson = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'))
    return appJson.expo && appJson.expo.version ? String(appJson.expo.version) : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Copy the built APK next to the repository root with a friendly name:
 *   HabitTracker-v1.1.0.apk
 * Returns the destination path, or null if the copy failed (a warning only —
 * the Gradle output still exists at releaseApk).
 */
function copyFriendlyApk(sourceApk = releaseApk, destDir = repoRoot, version = readAppVersion()) {
  const dest = path.join(destDir, `HabitTracker-v${version}.apk`)
  try {
    fs.copyFileSync(sourceApk, dest)
    return dest
  } catch (e) {
    console.warn(`[build-android-apk] could not copy the APK to ${dest}: ${e.message}`)
    return null
  }
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) {
    console.error(`[build-android-apk] failed to start ${command}: ${result.error.message}`)
    return 1
  }
  return result.status === 0 ? 0 : (result.status || 1)
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

  const friendlyApk = copyFriendlyApk()
  console.log(`[build-android-apk] APK ready: ${releaseApk}`)
  if (friendlyApk) {
    console.log(`[build-android-apk] clean-named copy for sharing/installing: ${friendlyApk}`)
  }
  return 0
}

if (require.main === module) process.exitCode = main()

module.exports = {
  androidRoot,
  wrapperName,
  wrapperPath,
  releaseApk,
  repoRoot,
  readAppVersion,
  copyFriendlyApk,
  main
}
