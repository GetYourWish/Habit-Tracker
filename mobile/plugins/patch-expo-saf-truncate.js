#!/usr/bin/env node
'use strict';

/**
 * Patches expo-file-system's Android legacy module inside node_modules:
 *
 *   writeAsStringAsync() on a content:// (SAF) document opens the stream with
 *   contentResolver.openOutputStream(uri, "w"). On several Android document
 *   providers "w" does NOT reliably truncate an EXISTING document: the new
 *   bytes are written from offset 0, and when the new content is SHORTER
 *   than what is already there, the previous content's tail bytes stay on
 *   disk after the new content. habit.json is pretty-printed JSON whose
 *   final byte is '}' — a shorter rewrite therefore produces a complete,
 *   valid JSON document followed by the old document's trailing '}' (plus
 *   whatever whitespace preceded it), and the next load dies with
 *
 *       Corrupt JSON: JSON Parse error: Unexpected character: }
 *
 *   — exactly the remote-reported 2026-09-21 failure, where EVERY mutation
 *   (theme change, adding a task) ended on the corrupt-file recovery screen
 *   while "Restore latest backup" kept working (a restore rewrites the file
 *   with content at least as long as the damaged one, so its own overwrite
 *   verifies fine — which is why the loop looked so confounding).
 *
 *   The corruption is invisible to the app's byte-verification read-back
 *   only in the sense that the read-back CATCHES it (the store throws
 *   'Final write verification failed'); the file on disk is nonetheless
 *   damaged, which is what matters for the next launch.
 *
 *   Fix: open with "rwt" — part of openOutputStream's documented mode set
 *   ("w", "wa", "rw", "rwt") and the mode that explicitly carries
 *   MODE_TRUNCATE through ParcelFileDescriptor.parseMode — so the document
 *   is always emptied before the new content lands. If a provider rejects
 *   the truncating mode (none known, but SAF is OEM territory), fall back
 *   to expo's original "w" behavior; the store's JS-level
 *   verify-and-recreate repair cycle (src/storage/store.js, writeData)
 *   then contains any residual corruption on its own.
 *
 * Runs in TWO places so the flow is order-proof (same wiring as
 * patch-expo-fs-leak.js):
 *   1. npm postinstall of @habit-tracker/mobile — `npm install`
 *      restores pristine files, this immediately re-applies the patch
 *   2. every prebuild, via plugins/with-expo-saf-truncate.js
 *
 * Idempotent and anchored: the patch is a single exact-string replacement;
 * if expo ships the fix (or reshapes the function), the anchor no longer
 * matches and the script logs a one-line skip — it can never break a build.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[with-expo-saf-truncate]';

const MODULE_REL =
  'expo-file-system/android/src/main/java/expo/modules/filesystem/legacy/FileSystemLegacyModule.kt';

// Pristine expo-file-system 57.0.6 (checked against the installed tree).
const ANCHOR = `  @Throws(IOException::class)
  private fun getOutputStream(uri: Uri, append: Boolean = false) = when {
    uri.scheme == "file" -> FileOutputStream(uri.toFile(), append)
    uri.isSAFUri -> context.contentResolver.openOutputStream(uri, if (append) "wa" else "w")!!
    else -> throw IOException("Unsupported scheme for location '$uri'.")
  }`;

const REPLACEMENT = `  @Throws(IOException::class)
  private fun getOutputStream(uri: Uri, append: Boolean = false) = when {
    uri.scheme == "file" -> FileOutputStream(uri.toFile(), append)
    uri.isSAFUri -> {
      // Habit-Tracker patch (2026-09-21 corruption class): "w" is NOT
      // guaranteed to truncate an EXISTING document on every
      // DocumentsProvider. Providers that open "w" without MODE_TRUNCATE
      // leave the previous (longer) content's tail bytes behind after a
      // shorter write — a complete new JSON followed by the old final '}' ->
      // "JSON Parse error: Unexpected character: }" on the next load.
      // "rwt" is part of openOutputStream's documented mode set ("w", "wa",
      // "rw", "rwt") and carries MODE_TRUNCATE explicitly, so the
      // destination is always emptied before the new content is written.
      val mode = if (append) "wa" else "rwt"
      try {
        context.contentResolver.openOutputStream(uri, mode)!!
      } catch (e: Exception) {
        if (append) throw e
        // A provider that rejects the truncating mode (none known) falls
        // back to expo's original behavior; the app's JS-level
        // verify-and-recreate repair cycle (store.writeData) then contains
        // any residual corruption.
        context.contentResolver.openOutputStream(uri, "w")!!
      }
    }
    else -> throw IOException("Unsupported scheme for location '$uri'.")
  }`;

const MARKER = 'val mode = if (append) "wa" else "rwt"';

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

/**
 * Pure string transform, exported for unit tests (same contract as
 * patch-expo-gradle-kotlin.js): returns the patched source, or null when the
 * anchor is absent (expo changed shape) or the patch is already applied.
 */
function patchGetOutputStreamSource(src, file, tag = TAG) {
  if (src.includes(MARKER)) {
    console.log(`${tag} already patched: ${file}`);
    return src;
  }
  const idx = src.indexOf(ANCHOR);
  if (idx === -1) {
    // expo shipped a different shape — either they fixed truncation
    // themselves or restructured the function. Never fail the build for this.
    console.warn(`${tag} anchor not found (expo-file-system layout changed?) — leaving ${file} untouched`);
    return null;
  }
  return src.slice(0, idx) + REPLACEMENT + src.slice(idx + ANCHOR.length);
}

function patchOne(file) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn(`${TAG} skip: cannot read ${file} (${e.message})`);
    return false;
  }

  const patched = patchGetOutputStreamSource(src, file);
  if (patched === null || patched === src) return patched === src;

  try {
    fs.writeFileSync(file, patched);
  } catch (e) {
    console.warn(`${TAG} FAILED to write ${file}: ${e.message}`);
    return false;
  }
  console.log(`${TAG} patched: SAF document writes now open with the truncating "rwt" mode -> ${file}`);
  return true;
}

function patchExpoSafTruncate(startDir) {
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
    console.warn(`${TAG} no expo-file-system legacy module patched (truncate guard inactive this run)`);
  }
}

module.exports = {
  patchExpoSafTruncate,
  patchGetOutputStreamSource,
  ANCHOR,
  REPLACEMENT,
  MARKER
};

if (require.main === module) {
  patchExpoSafTruncate(path.resolve(__dirname, '..'));
}
