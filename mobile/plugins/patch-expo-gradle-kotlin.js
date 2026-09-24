#!/usr/bin/env node
'use strict';

/**
 * Patches expo's Gradle tooling inside node_modules for the RN 0.87 toolchain:
 *
 * 1. Kotlin Gradle Plugin pins (expo-modules-autolinking expo-gradle-plugin +
 *    expo-modules-core expo-module-gradle-plugin): Gradle 9.4.1 (required by
 *    AGP 9.2.1 in RN 0.87.1's version catalog) ships kotlin-stdlib 2.3.0 on
 *    its classpath, while expo pins KGP 2.1.20, whose compiler only reads
 *    Kotlin metadata up to 2.2.0 -> every compileKotlin of those plugins
 *    fails with "Incompatible classes were found in dependencies".
 *    Fix: bump the pins to KGP 2.3.0 (and migrate the removed
 *    `kotlinOptions` DSL in the shared subproject).
 *
 * 2. AGP 9 runtime compatibility (only when react-native's catalog pins
 *    AGP >= 9): expo's prebuild-era plugin sources call APIs that AGP 9
 *    removed:
 *      - LibraryDefaultConfig.setTargetSdk (libraries no longer own targetSdk)
 *      - LibraryExtension.lintOptions (replaced by the lint block)
 *      - buildConfig feature is disabled by default (expo modules add
 *        custom BuildConfig fields)
 *      - automatic SoftwareComponent creation (components.release) gone,
 *        breaking the publishing setup
 *      - srcDirs(Provider) forbidden in the SourceSet DSL
 *      - :expo:releaseSourcesJar packages generatePackagesList output
 *        without a declared dependency (Gradle 9 implicit-dependency error)
 *    The two included builds compile from source at build time, so patching
 *    their Kotlin sources fixes the runtime failures.
 *
 * 3. worklets 0.12 compat (only when react-native-worklets >= 0.12):
 *    expo-modules-core's C++ glue (WorkletJSCallInvoker.cpp) calls
 *    WorkletRuntime.executeSync, which worklets 0.12 renamed to runSync,
 *    failing the C++ build with "no member named 'executeSync' in
 *    'worklets::WorkletRuntime'".
 *
 * Runs in TWO places so the flow is order-proof:
 *   1. npm postinstall of @habit-tracker/mobile — `npm install` restores
 *      pristine files, this immediately re-applies the patch
 *   2. every prebuild, via plugins/with-expo-gradle-kotlin.js
 *
 * Every decision is logged with the [with-expo-gradle-kotlin] tag so build
 * output always shows whether and where the patch was applied.
 *
 * Idempotent and version-gated: KGP pins >= 2.2.0 and AGP < 9 are left
 * untouched, so each patch becomes a no-op once upstream ships a compatible
 * version.
 */

const fs = require('fs');
const path = require('path');

const TAG = '[with-expo-gradle-kotlin]';
const KGP_MIN = [2, 2, 0]; // compilers >= 2.2.0 read Kotlin 2.3.0 metadata
const KGP_TARGET = '2.3.0';

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

function parseVersion(version) {
  return version.split('.').map((n) => parseInt(n, 10) || 0);
}

function isOlderThan(version, min) {
  const v = parseVersion(version);
  for (let i = 0; i < min.length; i++) {
    if ((v[i] || 0) !== min[i]) return (v[i] || 0) < min[i];
  }
  return false;
}

/**
 * Patch every `kotlin("<plugin>") version "X"` occurrence whose X < KGP_MIN.
 * Returns updated contents, the unchanged contents (nothing to do), or null
 * after printing a loud warning when the expected pin is absent.
 */
function replaceVersionPin(contents, pluginId, label, filePath) {
  const re = new RegExp(
    'kotlin\\("' + pluginId.replace(/\./g, '\\.') + '"\\) version "(\\d+\\.\\d+\\.\\d+)"',
    'g'
  );
  const matches = Array.from(contents.matchAll(re));
  if (matches.length === 0) {
    console.warn(
      `${TAG} WARNING: ${label} exists but has no kotlin("${pluginId}") version pin — ` +
        `upstream layout changed, patch NOT applied (${filePath}). ` +
        `If the Gradle build then fails with "Incompatible classes were found in dependencies", ` +
        `plugins/patch-expo-gradle-kotlin.js needs an update.`
    );
    return null;
  }
  let out = contents;
  for (const m of matches) {
    if (isOlderThan(m[1], KGP_MIN)) {
      out = out.split(m[0]).join(`kotlin("${pluginId}") version "${KGP_TARGET}"`);
      console.log(`${TAG} patched ${label}: kotlin("${pluginId}") ${m[1]} -> ${KGP_TARGET}`);
    } else {
      console.log(
        `${TAG} ok: ${label} kotlin("${pluginId}") ${m[1]} ` +
          `(reads Kotlin 2.3 metadata, no patch needed)`
      );
    }
  }
  return out;
}

/**
 * Kotlin >= 2.2 removed the `kotlinOptions {}` DSL (error-level deprecation on
 * this classpath), so the one build script still using it is migrated to
 * `compilerOptions {}` / JvmTarget. Returns updated contents, unchanged
 * contents (already migrated), or null after a loud warning.
 */
function patchKotlinOptionsDsl(contents, label, filePath) {
  if (!/kotlinOptions/.test(contents)) {
    console.log(`${TAG} ok: ${label} uses compilerOptions (kotlinOptions migration not needed)`);
    return contents;
  }
  const re =
    /(tasks\.withType<KotlinCompile> \{\n)(\s*)kotlinOptions \{\n\s*jvmTarget = (JavaVersion\.VERSION_\d+)\.toString\(\)\n\s*\}\n(\s*\})/;
  const m = contents.match(re);
  if (!m) {
    console.warn(
      `${TAG} WARNING: ${label} still uses the removed "kotlinOptions" DSL but did not match ` +
        `the expected shape — migration NOT applied (${filePath}). ` +
        `The Gradle build will fail until plugins/patch-expo-gradle-kotlin.js is updated.`
    );
    return null;
  }
  const jvmTarget = m[3].replace('JavaVersion.VERSION_', 'JVM_');
  console.log(`${TAG} patched ${label}: kotlinOptions -> compilerOptions (JvmTarget.${jvmTarget})`);
  return contents.replace(
    re,
    (match, head, indent, version, tail) =>
      `${head}${indent}compilerOptions {\n` +
      `${indent}  jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.${jvmTarget})\n` +
      `${indent}}\n${tail}`
  );
}

/* ------------------------------------------------------------------ *
 * AGP 9 runtime-compat patches (see the docblock, section 2).
 * Each is gated on react-native's catalog pinning AGP >= 9 and is
 * idempotent via its [with-agp9-compat] marker comment.
 * ------------------------------------------------------------------ */

const AGP9_MARKER = '[with-agp9-compat]';

/** AGP major version pinned by react-native's gradle/libs.versions.toml, or null. */
function readCatalogAgpMajor(nodeModulesList) {
  for (const nm of nodeModulesList) {
    const tomlPath = path.join(nm, 'react-native', 'gradle', 'libs.versions.toml');
    if (!fs.existsSync(tomlPath)) continue;
    const m = fs.readFileSync(tomlPath, 'utf8').match(/^agp\s*=\s*"(\d+)\./m);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Drop targetSdk from library defaultConfig + enable the buildConfig feature. */
function patchAndroidLibraryExtensionAgp9(contents, label, filePath) {
  if (contents.includes(`${AGP9_MARKER} LibraryDefaultConfig`)) {
    console.log(`${TAG} ok: ${label} already carries the AGP 9 buildConfig/targetSdk patch`);
    return contents;
  }
  const sdkVersionsOld = [
    '  defaultConfig {',
    '    this@defaultConfig.minSdk = minSdk',
    '    this@defaultConfig.targetSdk = targetSdk',
    '  }',
    '}',
  ].join('\n');
  const sdkVersionsNew = [
    '  defaultConfig {',
    '    this@defaultConfig.minSdk = minSdk',
    `    // ${AGP9_MARKER} LibraryDefaultConfig.setTargetSdk(Integer) was removed in AGP 9;`,
    '    // a library\'s targetSdk is ignored by the app manifest merge anyway.',
    '  }',
    `  // ${AGP9_MARKER} AGP 9 disables the buildConfig feature by default,`,
    '  // but expo modules add custom BuildConfig fields.',
    '  buildFeatures { buildConfig = true }',
    '}',
  ].join('\n');
  if (!contents.includes(sdkVersionsOld)) {
    console.warn(
      `${TAG} WARNING: ${label} does not match the expected applySDKVersions shape — ` +
        `AGP 9 targetSdk/buildConfig patch NOT applied (${filePath}). The build will fail with ` +
        `"'void com.android.build.api.dsl.LibraryDefaultConfig.setTargetSdk"' until this script is updated.`
    );
    return null;
  }
  let out = contents.replace(sdkVersionsOld, sdkVersionsNew);

  const lintOld = [
    'internal fun LibraryExtension.applyLinterOptions() {',
    '  lintOptions.isAbortOnError = false',
    '}',
  ].join('\n');
  const lintNew = [
    'internal fun LibraryExtension.applyLinterOptions() {',
    `  // ${AGP9_MARKER} lintOptions was removed in AGP 9; debug builds do not run lint.`,
    '}',
  ].join('\n');
  if (!out.includes(lintOld)) {
    console.warn(
      `${TAG} WARNING: ${label} does not match the expected applyLinterOptions shape — ` +
        `lint patch NOT applied (${filePath}). The build may fail with a lintOptions error.`
    );
    return null;
  }
  out = out.replace(lintOld, lintNew);
  console.log(
    `${TAG} patched ${label}: dropped library targetSdk + lintOptions (removed in AGP 9), enabled buildConfig`
  );
  return out;
}

/** Skip expo's publishing setup (AGP 9 removed automatic SoftwareComponents). */
function patchProjectConfigurationAgp9(contents, label, filePath) {
  if (contents.includes(`${AGP9_MARKER} AGP 9 removed automatic SoftwareComponent`)) {
    console.log(`${TAG} ok: ${label} already carries the AGP 9 publishing patch`);
    return contents;
  }
  const old = [
    'internal fun Project.applyPublishing(expoModulesExtension: ExpoModuleExtension) {',
    '  if (!expoModulesExtension.canBePublished) {',
    '    createEmptyExpoPublishTask()',
    '    createEmptyExpoPublishToMavenLocalTask()',
    '    return',
    '  }',
  ].join('\n');
  const patched = [
    'internal fun Project.applyPublishing(expoModulesExtension: ExpoModuleExtension) {',
    `  // ${AGP9_MARKER} AGP 9 removed automatic SoftwareComponent creation`,
    '  // (components.release); publishing is irrelevant for consuming app builds.',
    '  createEmptyExpoPublishTask()',
    '  createEmptyExpoPublishToMavenLocalTask()',
    '  return',
    '  if (!expoModulesExtension.canBePublished) {',
    '    createEmptyExpoPublishTask()',
    '    createEmptyExpoPublishToMavenLocalTask()',
    '    return',
    '  }',
  ].join('\n');
  if (!contents.includes(old)) {
    console.warn(
      `${TAG} WARNING: ${label} does not match the expected applyPublishing shape — ` +
        `AGP 9 publishing patch NOT applied (${filePath}). The build will fail with ` +
        `"SoftwareComponent with name 'release' not found" until this script is updated.`
    );
    return null;
  }
  console.log(`${TAG} patched ${label}: publishing path disabled under AGP 9 (empty publish tasks)`);
  return contents.replace(old, patched);
}

/** Resolve the Providers passed to srcDirs — forbidden by AGP 9's SourceSet DSL. */
function patchExpoAutolinkingPluginAgp9(contents, label, filePath) {
  if (contents.includes(`${AGP9_MARKER} AGP 9 forbids adding Provider instances`)) {
    console.log(`${TAG} ok: ${label} already carries the AGP 9 srcDirs patch`);
    return contents;
  }
  const old = [
    '    // Adds the generated file to the source set.',
    '    project.extensions.getByType(AndroidComponentsExtension::class.java).finalizeDsl { ext ->',
    '      ext',
    '        .sourceSets',
    '        .getByName("main")',
    '        .java',
    '        .srcDirs(getPackageListDir(project), getInlineModulesDir(project))',
    '    }',
  ].join('\n');
  const patched = [
    '    // Adds the generated file to the source set.',
    `    // ${AGP9_MARKER} AGP 9 forbids adding Provider instances to the SourceSet`,
    '    // DSL, so resolve the build-directory Providers to plain files first.',
    '    project.extensions.getByType(AndroidComponentsExtension::class.java).finalizeDsl { ext ->',
    '      ext',
    '        .sourceSets',
    '        .getByName("main")',
    '        .java',
    '        .srcDirs(',
    '          getPackageListDir(project).get().asFile,',
    '          getInlineModulesDir(project).get().asFile',
    '        )',
    '    }',
  ].join('\n');
  if (!contents.includes(old)) {
    console.warn(
      `${TAG} WARNING: ${label} does not match the expected srcDirs shape — ` +
        `AGP 9 srcDirs patch NOT applied (${filePath}). The build will fail with ` +
        `"You cannot add Provider instances to the Android SourceSet API" until this script is updated.`
    );
    return null;
  }
  console.log(`${TAG} patched ${label}: srcDirs(Provider) -> srcDirs(File) for AGP 9`);
  return contents.replace(old, patched);
}

/**
 * Gradle 9 fails assembleRelease with:
 *   Task ':expo:releaseSourcesJar' uses this output of task ':expo:generatePackagesList'
 *   without declaring an explicit or implicit dependency.
 *
 * generatePackagesList writes build/generated/expo/src/main/java, which is on
 * the main source set, so AGP's withSourcesJar() task packages it. preBuild
 * already depends on generatePackagesList (so compilation is ordered); the
 * sources JAR does not. Wire every *SourcesJar task to that producer.
 */
function patchExpoAutolinkingSourcesJarAgp9(contents, label, filePath) {
  if (contents.includes(`${AGP9_MARKER} Gradle 9 fails assembleRelease when releaseSourcesJar`)) {
    console.log(`${TAG} ok: ${label} already wires SourcesJar -> generatePackagesList`);
    return contents;
  }
  const old = [
    '    // Ensures that the task is executed before the build.',
    '    project.tasks',
    '      .named("preBuild", Task::class.java)',
    '      .dependsOn(generatePackagesList)',
    '',
    '    // Adds the generated file to the source set.',
  ].join('\n');
  const patched = [
    '    // Ensures that the task is executed before the build.',
    '    project.tasks',
    '      .named("preBuild", Task::class.java)',
    '      .dependsOn(generatePackagesList)',
    '',
    `    // ${AGP9_MARKER} Gradle 9 fails assembleRelease when releaseSourcesJar`,
    '    // packages build/generated/expo/src/main/java (output of generatePackagesList)',
    '    // without declaring a dependency on that task.',
    '    project.tasks.configureEach { task ->',
    '      if (task.name.endsWith("SourcesJar")) {',
    '        task.dependsOn(generatePackagesList)',
    '      }',
    '    }',
    '',
    '    // Adds the generated file to the source set.',
  ].join('\n');
  if (!contents.includes(old)) {
    console.warn(
      `${TAG} WARNING: ${label} does not match the expected preBuild.dependsOn(generatePackagesList) shape — ` +
        `SourcesJar dependency patch NOT applied (${filePath}). The build will fail with ` +
        `":expo:releaseSourcesJar uses this output of task ':expo:generatePackagesList'" until this script is updated.`
    );
    return null;
  }
  console.log(`${TAG} patched ${label}: *SourcesJar.dependsOn(generatePackagesList) for Gradle 9`);
  return contents.replace(old, patched);
}

const EXPO_SOURCES_JAR_MARKER = `${AGP9_MARKER} releaseSourcesJar dependsOn generatePackagesList`;

/**
 * Same SourcesJar fix, applied directly on :expo's Groovy build.gradle.
 * Takes effect on the next Gradle run without recompiling the autolinking
 * included-build (the .kt patch above does that on a cold plugin compile).
 */
function patchExpoAndroidBuildGradleSourcesJar(contents, label, filePath) {
  if (contents.includes(EXPO_SOURCES_JAR_MARKER)) {
    console.log(`${TAG} ok: ${label} already wires SourcesJar -> generatePackagesList`);
    return contents;
  }
  const block = [
    '',
    `// ${EXPO_SOURCES_JAR_MARKER}`,
    '// Gradle 9: :expo:releaseSourcesJar packages generatePackagesList output.',
    'tasks.configureEach { task ->',
    '  if (task.name.endsWith("SourcesJar")) {',
    '    task.dependsOn("generatePackagesList")',
    '  }',
    '}',
    '',
  ].join('\n');
  console.log(`${TAG} patched ${label}: SourcesJar.dependsOn(generatePackagesList)`);
  if (!contents.endsWith('\n')) contents += '\n';
  return contents + block;
}

/** react-native-worklets version from the candidate node_modules list, or null. */
function readWorkletsVersion(nodeModulesList) {
  for (const nm of nodeModulesList) {
    const pkgPath = path.join(nm, 'react-native-worklets', 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * worklets 0.12 renamed WorkletRuntime.executeSync -> runSync; expo's glue
 * still calls the old name. A pure rename at the single call site: runSync
 * is a drop-in template overload taking the same (jsi::Runtime&) -> jsi::Value
 * job. Returns updated contents, unchanged contents (already patched), or
 * null after printing a loud warning when neither symbol is found.
 */
function patchWorkletsExecuteSync(contents, label, filePath) {
  if (!/->\s*executeSync\s*\(/.test(contents)) {
    if (/->\s*runSync\s*\(/.test(contents)) {
      console.log(`${TAG} ok: ${label} already uses runSync (worklets 0.12 API)`);
      return contents;
    }
    console.warn(
      `${TAG} WARNING: ${label} contains neither executeSync nor runSync — ` +
        `upstream layout changed, patch NOT applied (${filePath}). If the C++ build fails with ` +
        `"no member named 'executeSync' in 'worklets::WorkletRuntime'", ` +
        `plugins/patch-expo-gradle-kotlin.js needs an update.`
    );
    return null;
  }
  console.log(`${TAG} patched ${label}: WorkletRuntime.executeSync -> runSync (renamed in worklets 0.12)`);
  return contents.replace(/->\s*executeSync\s*\(/g, '->runSync(');
}

/**
 * Apply patchFns to the target file in EVERY candidate node_modules that has
 * it (patching all copies avoids guessing which copy the Gradle build will
 * resolve). Returns false when the file was not found anywhere.
 */
function patchTarget(nodeModulesList, targetSegments, label, patchFns) {
  let found = false;
  for (const nm of nodeModulesList) {
    const filePath = path.join(nm, ...targetSegments);
    if (!fs.existsSync(filePath)) continue;
    found = true;
    const original = fs.readFileSync(filePath, 'utf8');
    let contents = original;
    for (const patchFn of patchFns) {
      const result = patchFn(contents, label, filePath);
      if (result === null) return false; // loud warning already printed
      contents = result;
    }
    if (contents !== original) fs.writeFileSync(filePath, contents);
  }
  if (!found) {
    console.warn(
      `${TAG} WARNING: ${label} not found in any node_modules above the project:\n` +
        nodeModulesList.map((nm) => `${TAG}   tried ${path.join(nm, ...targetSegments)}`).join('\n') +
        `\n${TAG} WARNING: without this patch the Gradle build fails with ` +
        `"Incompatible classes were found in dependencies". If upstream moved this file, ` +
        `plugins/patch-expo-gradle-kotlin.js needs an update.`
    );
  }
  return found;
}

/**
 * Patch the Kotlin pins inside expo's included Gradle builds.
 * @param {string} startDir project directory to walk up from (e.g. mobile/)
 * @returns {boolean} true when every target file was found (patched or already ok)
 */
function patchExpoGradleKotlin(startDir) {
  const candidates = findNodeModulesCandidates(startDir);
  if (candidates.length === 0) {
    console.warn(`${TAG} skip: no node_modules found above ${startDir} (nothing to patch)`);
    return false;
  }
  console.log(`${TAG} scanning: ${candidates.join(' -> ')}`);

  const autolinking = ['expo-modules-autolinking', 'android', 'expo-gradle-plugin'];

  let allFound = true;
  allFound =
    patchTarget(candidates, [...autolinking, 'build.gradle.kts'], 'expo-gradle-plugin/build.gradle.kts', [
      (c, l, f) => replaceVersionPin(c, 'jvm', l, f),
    ]) && allFound;

  allFound =
    patchTarget(
      candidates,
      [...autolinking, 'expo-autolinking-plugin-shared', 'build.gradle.kts'],
      'expo-autolinking-plugin-shared/build.gradle.kts',
      [
        (c, l, f) => replaceVersionPin(c, 'plugin.serialization', l, f),
        patchKotlinOptionsDsl,
      ]
    ) && allFound;

  allFound =
    patchTarget(
      candidates,
      ['expo-modules-core', 'expo-module-gradle-plugin', 'build.gradle.kts'],
      'expo-module-gradle-plugin/build.gradle.kts',
      [(c, l, f) => replaceVersionPin(c, 'jvm', l, f)]
    ) && allFound;

  // AGP 9 runtime-compat patches (source patches to the included builds,
  // which recompile at build time). Only when react-native's catalog pins
  // AGP >= 9 — otherwise these files work as shipped.
  const agpMajor = readCatalogAgpMajor(candidates);
  if (agpMajor !== null && agpMajor >= 9) {
    console.log(`${TAG} react-native catalog pins AGP ${agpMajor}.x -> applying AGP 9 runtime patches`);
    allFound =
      patchTarget(
        candidates,
        [
          'expo-modules-core',
          'expo-module-gradle-plugin',
          'src',
          'main',
          'kotlin',
          'expo',
          'modules',
          'plugin',
          'android',
          'AndroidLibraryExtension.kt',
        ],
        'expo-module-gradle-plugin/.../AndroidLibraryExtension.kt',
        [patchAndroidLibraryExtensionAgp9]
      ) && allFound;

    allFound =
      patchTarget(
        candidates,
        [
          'expo-modules-core',
          'expo-module-gradle-plugin',
          'src',
          'main',
          'kotlin',
          'expo',
          'modules',
          'plugin',
          'ProjectConfiguration.kt',
        ],
        'expo-module-gradle-plugin/.../ProjectConfiguration.kt',
        [patchProjectConfigurationAgp9]
      ) && allFound;

    allFound =
      patchTarget(
        candidates,
        [
          'expo-modules-autolinking',
          'android',
          'expo-gradle-plugin',
          'expo-autolinking-plugin',
          'src',
          'main',
          'kotlin',
          'expo',
          'modules',
          'plugin',
          'ExpoAutolinkingPlugin.kt',
        ],
        'expo-gradle-plugin/expo-autolinking-plugin/.../ExpoAutolinkingPlugin.kt',
        [patchExpoAutolinkingPluginAgp9, patchExpoAutolinkingSourcesJarAgp9]
      ) && allFound;

    allFound =
      patchTarget(
        candidates,
        ['expo', 'android', 'build.gradle'],
        'expo/android/build.gradle',
        [patchExpoAndroidBuildGradleSourcesJar]
      ) && allFound;
  } else if (agpMajor !== null) {
    console.log(`${TAG} react-native catalog pins AGP ${agpMajor}.x < 9 -> AGP 9 patches skipped`);
  }

  // worklets 0.12 runtime-compat patch (source patch to expo-modules-core's
  // C++ glue, which recompiles at build time). Only when the installed
  // react-native-worklets is >= 0.12 — otherwise the file works as shipped.
  const workletsVersion = readWorkletsVersion(candidates);
  if (workletsVersion !== null && !isOlderThan(workletsVersion, [0, 12])) {
    console.log(
      `${TAG} react-native-worklets ${workletsVersion} >= 0.12 -> applying WorkletRuntime API patch`
    );
    allFound =
      patchTarget(
        candidates,
        ['expo-modules-core', 'android', 'src', 'main', 'cpp', 'worklets', 'WorkletJSCallInvoker.cpp'],
        'expo-modules-core/.../WorkletJSCallInvoker.cpp',
        [patchWorkletsExecuteSync]
      ) && allFound;
  } else if (workletsVersion !== null) {
    console.log(`${TAG} react-native-worklets ${workletsVersion} < 0.12 -> WorkletRuntime API patch skipped`);
  }

  return allFound;
}

module.exports = {
  patchExpoGradleKotlin,
  patchExpoAutolinkingSourcesJarAgp9,
  patchExpoAndroidBuildGradleSourcesJar,
  AGP9_MARKER,
};

if (require.main === module) {
  // Run as `node plugins/patch-expo-gradle-kotlin.js` (mobile postinstall).
  // Walk up from mobile/ so both workspace-root and nested node_modules are scanned.
  const ok = patchExpoGradleKotlin(path.join(__dirname, '..'));
  if (!ok) {
    process.exitCode = 1; // make the drift impossible to miss during npm install
  }
}
