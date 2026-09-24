/**
 * Local Expo config plugin: re-applies the Expo Gradle-plugin Kotlin patches on
 * every prebuild, so a regenerated or freshly installed tree is always
 * buildable under Gradle 9.4.1 (required by the Android Gradle Plugin in the
 * RN 0.87 template).
 *
 * The actual patching lives in ./patch-expo-gradle-kotlin.js — a standalone
 * script with no Expo dependency, so the SAME logic also runs as the mobile
 * workspace's npm postinstall (npm install restores pristine node_modules
 * files; postinstall immediately re-applies the patch). See that file for the
 * full rationale, the exact edits, and the loud logging.
 *
 * Idempotent: version-gated (only bumps pins < 2.2.0), so it becomes a no-op
 * once Expo ships a compatible Kotlin pin.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const { patchExpoGradleKotlin } = require('./patch-expo-gradle-kotlin');

function withExpoGradleKotlin(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchExpoGradleKotlin(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withExpoGradleKotlin;
