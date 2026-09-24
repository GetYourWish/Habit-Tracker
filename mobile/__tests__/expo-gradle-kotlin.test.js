// Unit tests for the Gradle 9 :expo:releaseSourcesJar implicit-dependency
// patch in mobile/plugins/patch-expo-gradle-kotlin.js.
//
// assembleRelease fails on Gradle 9.4.1 with:
//   Task ':expo:releaseSourcesJar' uses this output of task
//   ':expo:generatePackagesList' without declaring an explicit or implicit
//   dependency.
// because generatePackagesList writes build/generated/expo/src/main/java,
// which is on the main source set, and AGP's sources JAR packages it
// without depending on the producer. The two transforms are pure string
// work against excerpts of the real Expo SDK 57 files.

const {
  patchExpoAutolinkingSourcesJarAgp9,
  patchExpoAndroidBuildGradleSourcesJar,
  AGP9_MARKER
} = require('../plugins/patch-expo-gradle-kotlin')

const AUTOLINKING_EXCERPT = `    val generatePackagesList = createGeneratePackagesListTask(project, gradleExtension.config.modules, gradleExtension.hash)

    // Ensures that the task is executed before the build.
    project.tasks
      .named("preBuild", Task::class.java)
      .dependsOn(generatePackagesList)

    // Adds the generated file to the source set.
    project.extensions.getByType(AndroidComponentsExtension::class.java).finalizeDsl { ext ->
      ext
        .sourceSets
        .getByName("main")
        .java
        .srcDirs(getPackageListDir(project), getInlineModulesDir(project))
    }
`

const EXPO_BUILD_GRADLE = `apply plugin: 'com.android.library'
apply plugin: 'expo-module-gradle-plugin'
apply plugin: "expo-autolinking"

expoModule {
  canBePublished false
}

dependencies {
  implementation 'com.facebook.react:react-android'
}
`

describe('patchExpoAutolinkingSourcesJarAgp9', () => {
  test('wires *SourcesJar to generatePackagesList after preBuild.dependsOn', () => {
    const out = patchExpoAutolinkingSourcesJarAgp9(
      AUTOLINKING_EXCERPT,
      'ExpoAutolinkingPlugin.kt',
      'fake.kt'
    )
    expect(out).not.toBeNull()
    expect(out).toContain('if (task.name.endsWith("SourcesJar"))')
    expect(out).toContain('task.dependsOn(generatePackagesList)')
    expect(out).toContain(`${AGP9_MARKER} Gradle 9 fails assembleRelease when releaseSourcesJar`)
    // preBuild dependency is preserved
    expect(out).toContain('.dependsOn(generatePackagesList)')
    const preBuildAt = out.indexOf('named("preBuild"')
    const sourcesAt = out.indexOf('endsWith("SourcesJar")')
    const srcDirsAt = out.indexOf('srcDirs')
    expect(preBuildAt).toBeGreaterThanOrEqual(0)
    expect(sourcesAt).toBeGreaterThan(preBuildAt)
    expect(srcDirsAt).toBeGreaterThan(sourcesAt)
  })

  test('is idempotent', () => {
    const once = patchExpoAutolinkingSourcesJarAgp9(AUTOLINKING_EXCERPT, 'x', 'x')
    const twice = patchExpoAutolinkingSourcesJarAgp9(once, 'x', 'x')
    expect(twice).toBe(once)
    expect(twice.split('endsWith("SourcesJar")').length - 1).toBe(1)
  })

  test('returns null with a warning when the preBuild block is gone', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const out = patchExpoAutolinkingSourcesJarAgp9('package expo.modules.plugin\n', 'x', 'x.kt')
    expect(out).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('patchExpoAndroidBuildGradleSourcesJar', () => {
  test('appends a Groovy SourcesJar -> generatePackagesList hook', () => {
    const out = patchExpoAndroidBuildGradleSourcesJar(
      EXPO_BUILD_GRADLE,
      'expo/android/build.gradle',
      'fake.gradle'
    )
    expect(out).toContain('task.name.endsWith("SourcesJar")')
    expect(out).toContain('task.dependsOn("generatePackagesList")')
    expect(out).toContain(AGP9_MARKER)
    // original body is untouched
    expect(out.startsWith(EXPO_BUILD_GRADLE.trimEnd())).toBe(true)
  })

  test('is idempotent', () => {
    const once = patchExpoAndroidBuildGradleSourcesJar(EXPO_BUILD_GRADLE, 'x', 'x')
    const twice = patchExpoAndroidBuildGradleSourcesJar(once, 'x', 'x')
    expect(twice).toBe(once)
    expect(twice.split('endsWith("SourcesJar")').length - 1).toBe(1)
  })
})
