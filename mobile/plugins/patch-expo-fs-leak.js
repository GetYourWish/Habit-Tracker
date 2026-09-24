#!/usr/bin/env node
'use strict';

/**
 * Patches expo-file-system's Android legacy module inside node_modules:
 *
 *   getInfoAsync() on a content:// URI opens an InputStream through the
 *   content resolver and NEVER CLOSES it. Every call leaks one file
 *   descriptor in the app process. Habit Tracker's store polls the
 *   folder every 15 s (stat-first change detection), so the app leaks
 *   ~240 fds/hour while it sits on the board screen; once the process fd
 *   ceiling is reached (hours on a real device), every subsequent SAF call
 *   fails or stalls — the app falls back to the re-grant screen until it is
 *   restarted, i.e. 'it works after a fresh install, then gets weird'.
 *
 *   Fix (upstream-exact): wrap the bundle construction in
 *   `inputStream.use { stream -> ... }` so the stream is closed on every
 *   exit path. `use` is inline, so the non-local `return@AsyncFunction`
 *   keeps compiling unchanged.
 *
 * Runs in TWO places so the flow is order-proof (same wiring as
 * patch-expo-gradle-kotlin.js):
 *   1. npm postinstall of @habit-tracker/mobile — `npm install`
 *      restores pristine files, this immediately re-applies the patch
 *   2. every prebuild, via plugins/with-expo-fs-leak.js
 *
 * Idempotent and anchored: the patch is a single exact-string replacement;
 * if expo ships the fix (or reshapes the function), the anchor no longer
 * matches and the script logs a one-line skip — it can never break a build.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[with-expo-fs-leak]';

const MODULE_REL =
  'expo-file-system/android/src/main/java/expo/modules/filesystem/legacy/FileSystemLegacyModule.kt';

// Pristine expo-file-system 57.0.6 (checked against the installed tree).
const ANCHOR = `          return@AsyncFunction Bundle().apply {
            putBoolean("exists", true)
            putBoolean("isDirectory", false)
            putString("uri", uri.toString())
            // NOTE: \`.available()\` is supposedly not a reliable source of size info, but it's been
            //       more reliable than querying \`OpenableColumns.SIZE\` in practice in tests ¯\\_(ツ)_/¯
            putDouble("size", inputStream.available().toDouble())
            if (options.md5 == true) {
              val md5bytes = DigestUtils.md5(inputStream)
              putString("md5", String(Hex.encodeHex(md5bytes)))
            }
          }`;

const REPLACEMENT = `          inputStream.use { stream ->
            return@AsyncFunction Bundle().apply {
              putBoolean("exists", true)
              putBoolean("isDirectory", false)
              putString("uri", uri.toString())
              // NOTE: \`.available()\` is supposedly not a reliable source of size info, but it's been
              //       more reliable than querying \`OpenableColumns.SIZE\` in practice in tests ¯\\_(ツ)_/¯
              // (patched by Habit-Tracker: stream is closed via use{} — every unpatched
              // call leaked one fd, and the 15 s change-detection poll exhausted the app's
              // fd ceiling after a few hours on device)
              putDouble("size", stream.available().toDouble())
              if (options.md5 == true) {
                val md5bytes = DigestUtils.md5(stream)
                putString("md5", String(Hex.encodeHex(md5bytes)))
              }
            }
          }`;

/**
 * Every existing node_modules from startDir upward (up to 5 levels).
 * npm workspaces hoist to the repo root, but a stray nested
 * <workspace>/node_modules must not make us stop looking too early.
 */
function findNodeModulesCandidates(startDir) {
  const found = [];
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'node_modules');
    if (fs.existsSync(candidate)) found.push(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return found;
}

function patchOne(file) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn(`${TAG} skip: cannot read ${file} (${e.message})`);
    return false;
  }

  if (src.includes('inputStream.use { stream ->')) {
    console.log(`${TAG} already patched: ${file}`);
    return true;
  }

  const idx = src.indexOf(ANCHOR);
  if (idx === -1) {
    // expo shipped a different shape — either they fixed the leak themselves
    // or restructured the function. Never fail the build for this.
    console.warn(`${TAG} anchor not found (expo-file-system layout changed?) — leaving ${file} untouched`);
    return false;
  }

  const patched = src.slice(0, idx) + REPLACEMENT + src.slice(idx + ANCHOR.length);
  try {
    fs.writeFileSync(file, patched);
  } catch (e) {
    console.warn(`${TAG} FAILED to write ${file}: ${e.message}`);
    return false;
  }
  console.log(`${TAG} patched: closed the leaked content-resolver stream in getInfoAsync → ${file}`);
  return true;
}

function patchExpoFsLeak(startDir) {
  const candidates = findNodeModulesCandidates(startDir);
  if (candidates.length === 0) {
    console.warn(`${TAG} skip: no node_modules found above ${startDir} (nothing to patch)`);
    return;
  }
  let touched = 0;
  for (const nm of candidates) {
    const file = path.join(nm, MODULE_REL);
    if (fs.existsSync(file) && patchOne(file)) touched++;
  }
  if (touched === 0) {
    console.warn(`${TAG} no expo-file-system legacy module patched (fd-leak guard inactive this run)`);
  }
}

module.exports = { patchExpoFsLeak };

if (require.main === module) {
  patchExpoFsLeak(path.resolve(__dirname, '..'));
}
