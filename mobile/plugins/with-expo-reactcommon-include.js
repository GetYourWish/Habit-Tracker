/**
 * Local Expo config plugin: re-applies the expo-modules-core ReactCommon
 * include patch on every prebuild, so a freshly installed tree always
 * compiles :expo-modules-core cleanly.
 *
 * Why: react-native 0.87's react-android prefab ships the cxxreact/ErrorUtils.h
 * deprecation shim but NOT the jserrorhandler/ headers it redirects to, and
 * expo-modules-core only adds ${REACT_NATIVE_DIR}/ReactCommon (the one place
 * those headers exist on disk) when react-native-worklets is installed. This
 * app removed worklets in v1.0.7, which turned the next full native rebuild
 * into:
 *
 *   Task :expo-modules-core:buildCMakeRelWithDebInfo[arm64-v8a] FAILED
 *   fatal error: 'jserrorhandler/ErrorUtils.h' file not found
 *
 * The actual patching lives in ./patch-expo-reactcommon-include.js — a
 * standalone script with no Expo dependency, so the SAME logic also runs as
 * the mobile workspace's npm postinstall (npm install restores pristine
 * node_modules files; postinstall immediately re-applies the patch) and as
 * part of npm run clean:native. See that file for the full root-cause
 * analysis, the exact edit, the compiler-level verification, and the loud
 * logging.
 *
 * Idempotent and anchored: once expo ships its own fix, the anchor stops
 * matching and the script becomes a logged no-op.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const { patchExpoReactCommonInclude } = require('./patch-expo-reactcommon-include');

function withExpoReactCommonInclude(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      patchExpoReactCommonInclude(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withExpoReactCommonInclude;
