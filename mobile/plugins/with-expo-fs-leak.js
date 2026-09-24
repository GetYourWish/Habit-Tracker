/**
 * Local Expo config plugin: re-applies the expo-file-system fd-leak patch on
 * every prebuild, so a regenerated or freshly installed tree always compiles
 * with the content-resolver stream closed in getInfoAsync (the store's 15 s
 * change-detection poll leaked one fd per call — a few hours on device and
 * every SAF call started failing).
 *
 * The actual patching lives in ./patch-expo-fs-leak.js — a standalone script
 * with no Expo dependency, so the SAME logic also runs as the mobile
 * workspace's npm postinstall (npm install restores pristine node_modules
 * files; postinstall immediately re-applies the patch). See that file for
 * the full rationale, the exact edit, and the loud logging.
 *
 * Idempotent and anchored: if expo ships the fix, the anchor stops matching
 * and the script becomes a logged no-op.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const { patchExpoFsLeak } = require('./patch-expo-fs-leak');

function withExpoFsLeak(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchExpoFsLeak(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withExpoFsLeak;
