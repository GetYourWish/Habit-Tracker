/**
 * Local Expo config plugin: re-apply the Windows CMake/ninja fix on every
 * prebuild, so a regenerated or freshly installed tree is always buildable
 * under `gradlew assembleRelease` on Windows.
 *
 * The actual patching lives in ./patch-windows-cmake.js — a standalone
 * script with no Expo dependency, so the SAME logic also runs as:
 *   - the mobile workspace's npm postinstall
 *   - npm run clean:native (the documented repair for this error)
 *
 * See that file for the root cause (CONFIGURE_DEPENDS + ninja on Windows)
 * and the exact edits. Idempotent.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const { patchWindowsCmake } = require('./patch-windows-cmake');

function withWindowsCmake(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchWindowsCmake(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withWindowsCmake;
