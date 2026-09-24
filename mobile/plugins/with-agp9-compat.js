/**
 * Local Expo config plugin: AGP 9 compatibility for Expo's prebuild template.
 *
 * Why: react-native 0.87.1's version catalog (gradle/libs.versions.toml) pins
 * AGP 9.2.1, but Expo's prebuild template (expo-template-bare-minimum up to
 * 57.0.20) still targets the AGP 8 pipeline. Under AGP 9 the generated project
 * fails during configuration with:
 *
 *   1. `apply plugin: "org.jetbrains.kotlin.android"` (app/build.gradle line 2)
 *      collides with AGP 9's built-in Kotlin:
 *        "Cannot add extension with name 'kotlin', as there is an extension
 *         already registered with that name."
 *      Even with built-in Kotlin disabled, KGP (2.2.0-2.3.0) rejects AGP 9's
 *      new DSL outright ("not compatible with AGP's 9.0 new DSL").
 *
 *   2. `getDefaultProguardFile("proguard-android.txt")` (app/build.gradle ~119)
 *      was removed in AGP 9 and throws during evaluation.
 *
 * Fix (verified against AGP 9.2.1 / Gradle 9.4.1 / KGP 2.2.0):
 *   - gradle.properties: `android.newDsl=false` + `android.builtInKotlin=false`
 *     restores the legacy AGP DSL so the template's KGP-based pipeline works
 *     unchanged, for :app AND every autolinked library module.
 *   - app/build.gradle: proguard-android.txt -> proguard-android-optimize.txt
 *     (the AGP 9 replacement; also valid on AGP 8).
 *
 * Self-disabling: the properties are only written while the generated
 * app/build.gradle still applies the Kotlin plugin (i.e. while the template is
 * KGP-based). Once Expo ships an AGP-9-native template (no `apply plugin:
 * "org.jetbrains.kotlin.android"`), both writes become no-ops.
 *
 * All decisions are logged with the [with-agp9-compat] tag. Every prebuild
 * re-applies this — the flow `npm install` -> `npm run prebuild` ->
 * `gradlew assembleDebug` is always correct.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-agp9-compat]';

const PROPS = [
  { key: 'android.newDsl', value: 'false' },
  { key: 'android.builtInKotlin', value: 'false' },
];

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

/** Read the AGP version pinned by react-native's version catalog (toml). */
function readCatalogAgpVersion(nodeModulesList) {
  for (const nm of nodeModulesList) {
    const tomlPath = path.join(nm, 'react-native', 'gradle', 'libs.versions.toml');
    if (!fs.existsSync(tomlPath)) continue;
    const toml = fs.readFileSync(tomlPath, 'utf8');
    const m = toml.match(/^agp\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m);
    if (m) {
      const version = `${m[1]}.${m[2]}.${m[3]}`;
      console.log(`${TAG} react-native catalog pins AGP ${version} (${tomlPath})`);
      return { major: parseInt(m[1], 10), version };
    }
  }
  console.warn(
    `${TAG} WARNING: react-native/gradle/libs.versions.toml not found — AGP version unknown, skipping AGP 9 writes`
  );
  return null;
}

/** Replace the AGP-9-removed proguard default. Returns true when patched. */
function patchAppBuildGradle(appGradleFile) {
  if (!fs.existsSync(appGradleFile)) {
    console.warn(`${TAG} skip: app/build.gradle not found at ${appGradleFile}`);
    return { templateUsesKgp: false };
  }
  const original = fs.readFileSync(appGradleFile, 'utf8');
  let contents = original;

  if (contents.includes('proguard-android.txt')) {
    contents = contents.split('proguard-android.txt').join('proguard-android-optimize.txt');
    console.log(`${TAG} patched app/build.gradle: proguard-android.txt -> proguard-android-optimize.txt`);
  }

  // Gate for the gradle.properties writes: they are only correct while the
  // template still applies KGP's android plugin. If Expo removes that line
  // upstream (built-in-Kotlin migration), these writes must stop.
  const templateUsesKgp = /^apply plugin: "org\.jetbrains\.kotlin\.android"$/m.test(contents);
  console.log(
    templateUsesKgp
      ? `${TAG} template applies org.jetbrains.kotlin.android (KGP-based) -> AGP 9 legacy-DSL properties will apply`
      : `${TAG} template no longer applies org.jetbrains.kotlin.android -> skipping gradle.properties writes (upstream migrated)`
  );

  if (contents !== original) fs.writeFileSync(appGradleFile, contents);
  return { templateUsesKgp };
}

/** Append the legacy-DSL properties unless already present. */
function patchGradleProperties(gradlePropsFile, shouldApply) {
  if (!fs.existsSync(gradlePropsFile)) {
    console.warn(`${TAG} skip: gradle.properties not found at ${gradlePropsFile}`);
    return;
  }
  if (!shouldApply) return;

  const original = fs.readFileSync(gradlePropsFile, 'utf8');
  let contents = original;

  for (const prop of PROPS) {
    const lineRegex = new RegExp(`^${prop.key.replace(/\./g, '\\.')}=(.*)$`, 'm');
    const existing = contents.match(lineRegex);
    if (existing) {
      if (existing[1].trim() !== prop.value) {
        console.warn(
          `${TAG} WARNING: ${prop.key}=${existing[1].trim()} already set in gradle.properties ` +
            `(expected ${prop.value}). Leaving it untouched — if the build fails with a ` +
            `"kotlin" extension conflict or an AGP new-DSL error, this is why.`
        );
      } else {
        console.log(`${TAG} ok: gradle.properties already has ${prop.key}=${prop.value}`);
      }
      continue;
    }
    if (!contents.endsWith('\n')) contents += '\n';
    contents += `${prop.key}=${prop.value}\n`;
    console.log(`${TAG} patched gradle.properties: + ${prop.key}=${prop.value}`);
  }

  if (contents !== original) fs.writeFileSync(gradlePropsFile, contents);
}

function withAgp9Compat(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const androidDir = path.join(config.modRequest.projectRoot, 'android');

      const { templateUsesKgp } = patchAppBuildGradle(path.join(androidDir, 'app', 'build.gradle'));

      let shouldApplyProps = false;
      if (templateUsesKgp) {
        const agp = readCatalogAgpVersion(findNodeModulesCandidates(config.modRequest.projectRoot));
        if (agp && agp.major >= 9) shouldApplyProps = true;
        else if (agp) console.log(`${TAG} AGP ${agp.version} < 9 -> no AGP 9 compatibility writes needed`);
      }

      patchGradleProperties(path.join(androidDir, 'gradle.properties'), shouldApplyProps);
      return config;
    },
  ]);
}

module.exports = withAgp9Compat;
