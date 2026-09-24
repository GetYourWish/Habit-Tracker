/**
 * Local Expo config plugin: embed the MaterialCommunityIcons TTF into the
 * generated android project's assets/fonts/ at prebuild time.
 *
 * See plugins/embed-icon-font.js for the full failure chain this closes
 * (the 2026-09-22 "blank spaces instead of icons" incident). The prebuild
 * plugin covers FRESH prebuilds; the same embedder also runs from
 * package.json postinstall to repair STALE prebuild folders.
 */

const { withDangerousMod } = require('@expo/config-plugins')
const path = require('path')
const { embedIconFont, TAG } = require('./embed-icon-font')

function withIconFont(config) {
  return withDangerousMod(config, [
    'android',
    async cfg => {
      const projectRoot = cfg.modRequest.projectRoot
      const result = embedIconFont(projectRoot, console.log)
      if (!result.ok && result.reason !== 'no-android-folder') {
        // Prebuild time IS the moment to be loud — the generated project is
        // about to be built into an APK.
        console.warn(
          `${TAG} WARNING: icon font was NOT embedded into android/app/src/main/assets/fonts ` +
            `(${result.reason}). Icons on device will depend on the fragile runtime ` +
            `asset path and may render blank.`
        )
      }
      return cfg
    }
  ])
}

module.exports = withIconFont
