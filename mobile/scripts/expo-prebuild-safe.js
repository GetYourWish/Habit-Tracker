#!/usr/bin/env node
'use strict';

/**
 * Safe wrapper around `expo prebuild -p android --clean`.
 *
 * `--clean` deletes the whole android/ directory — including
 * android/local.properties, the machine-local Gradle file that points the
 * build at the Android SDK. Wiping it breaks the next `gradlew assembleDebug`
 * with "SDK location not found" until the file is recreated by hand.
 *
 * This wrapper:
 *   1. stashes android/local.properties before prebuild and restores it after
 *   2. otherwise writes it from ANDROID_HOME when that env var is set
 *   3. otherwise probes the default SDK install locations per OS and writes
 *      the first one that looks like a real SDK
 *   4. otherwise prints how to fix the build environment (no failure —
 *      prebuild itself does not need an SDK)
 *
 * Any extra CLI args are passed through, e.g. `npm run prebuild -- --no-install`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAG = '[expo-prebuild-safe]';
const mobileRoot = path.resolve(__dirname, '..');
const androidDir = path.join(mobileRoot, 'android');
const localProperties = path.join(androidDir, 'local.properties');

function findSdkLocation() {
  const candidates = [];
  if (process.env.ANDROID_HOME && process.env.ANDROID_HOME.trim()) {
    candidates.push(path.resolve(process.env.ANDROID_HOME.trim()));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  }
  candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')); // Windows default
  candidates.push(path.join(os.homedir(), 'Library', 'Android', 'sdk')); // macOS default
  candidates.push(path.join(os.homedir(), 'Android', 'Sdk')); // Linux default

  for (const dir of candidates) {
    // A valid SDK has at least one of the marker directories.
    const looksLikeSdk = ['platform-tools', 'platforms', 'build-tools'].some((marker) =>
      fs.existsSync(path.join(dir, marker))
    );
    if (looksLikeSdk) return dir;
  }
  return null;
}

function main() {
  const preserved = fs.existsSync(localProperties) ? fs.readFileSync(localProperties, 'utf8') : null;
  if (preserved !== null) {
    console.log(`${TAG} stashing android/local.properties (clean prebuild deletes it)`);
  }

  const result = spawnSync(
    'npx',
    ['expo', 'prebuild', '-p', 'android', '--clean', ...process.argv.slice(2)],
    { cwd: mobileRoot, stdio: 'inherit', shell: process.platform === 'win32' }
  );

  if (result.error) {
    console.error(`${TAG} failed to run "npx expo prebuild": ${result.error.message}`);
  }

  if (preserved !== null && fs.existsSync(androidDir)) {
    if (fs.existsSync(localProperties)) {
      console.log(`${TAG} android/local.properties exists after prebuild — keeping the current copy`);
    } else {
      fs.writeFileSync(localProperties, preserved);
      console.log(`${TAG} restored android/local.properties (was deleted by --clean)`);
    }
  }

  if (!fs.existsSync(localProperties) && fs.existsSync(androidDir)) {
    const sdkDir = findSdkLocation();
    if (sdkDir) {
      const escaped = sdkDir.replace(/\\/g, '/');
      fs.writeFileSync(localProperties, `sdk.dir=${escaped}\n`);
      console.log(`${TAG} wrote android/local.properties -> sdk.dir=${escaped}`);
      if (!process.env.ANDROID_HOME) {
        console.log(
          `${TAG} (SDK detected at the default install location; ` +
            `set ANDROID_HOME to make this independent of prebuild)`
        );
      }
    } else {
      console.warn(
        `${TAG} WARNING: android/local.properties is missing and no Android SDK was found.\n` +
          `${TAG} gradlew assembleDebug will fail with "SDK location not found". Fix with ONE of:\n` +
          `${TAG}   1. Install Android Studio (installs the SDK at %LOCALAPPDATA%\\Android\\Sdk), then re-run\n` +
          `${TAG}   2. Set the ANDROID_HOME environment variable to your SDK path, then re-run\n` +
          `${TAG}   3. Create android/local.properties containing: sdk.dir=<path to your SDK>`
      );
    }
  }

  if (result.status !== 0) process.exitCode = result.status === null ? 1 : result.status;
}

main();
