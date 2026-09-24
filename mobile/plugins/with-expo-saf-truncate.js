/**
 * Local Expo config plugin: re-applies the expo-file-system SAF-truncate
 * patch on every prebuild, so a regenerated or freshly installed tree always
 * compiles with document overwrites opening in the truncating "rwt" mode
 * (with "w", several Android document providers do not truncate an existing
 * document, leaving the previous content's tail bytes behind after a shorter
 * write — the 2026-09-21 "Unexpected character: }" habit.json corruption
 * that fired on every theme change / task add).
 *
 * The actual patching lives in ./patch-expo-saf-truncate.js — a standalone
 * script with no Expo dependency, so the SAME logic also runs as the mobile
 * workspace's npm postinstall (npm install restores pristine node_modules
 * files; postinstall immediately re-applies the patch). See that file for
 * the full rationale, the exact edit, and the loud logging.
 *
 * Idempotent and anchored: if expo ships the fix, the anchor stops matching
 * and the script becomes a logged no-op.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const { patchExpoSafTruncate } = require('./patch-expo-saf-truncate');

function withExpoSafTruncate(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchExpoSafTruncate(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withExpoSafTruncate;
