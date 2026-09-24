/**
 * Local Expo config plugin: on-device crash logging.
 *
 * Why (observed 2026-09-16): the installed standalone build closes instantly
 * on open with no visible error. In RELEASE builds React Native has no red
 * error screen (that UI is dev-support only), so any fatal startup error —
 * native or JavaScript — just kills the process. Android DOES record the
 * reason, but reading it requires adb logcat, which the user cannot easily
 * provide ("there is no logs that im aware of").
 *
 * What this installs (all at prebuild time, CNG-sanctioned — mobile/android
 * is generated output and this is the sanctioned way to change it):
 *
 *   1. CrashLogProvider.kt — a ContentProvider in the app package. Android
 *      initializes providers BEFORE Application.onCreate, so the handler is
 *      active as early as anything can be. It replaces the default
 *      UncaughtExceptionHandler with one that first writes a report, then
 *      chains to the previous handler so the system still sees the crash.
 *
 *   2. A <provider> entry in AndroidManifest.xml so the class is loaded.
 *
 * Where reports land on the phone:
 *   - Downloads/habit-tracker-crash-<millis>.txt  (Android 10+ via MediaStore)
 *     → visible in any Files app, no adb, no developer options, and
 *       copyable off the phone over plain USB file transfer
 *   - app-private files dir, habit-tracker-crash-latest.txt (+ timestamped)
 *     → always written, even below Android 10
 *
 * Each report contains time, app version, device model + Android version,
 * thread name and the full stack trace (for release-mode JS crashes that
 * includes the JavaScript error text and bundle stack).
 *
 * Failure containment: the provider and the writer are wrapped so that
 * diagnostics can never crash the app or break crash delivery; the previous
 * UncaughtExceptionHandler always runs afterwards.
 *
 * Idempotent: the manifest edit is marker-guarded; the Kotlin file is
 * overwritten in full on every prebuild. Prebuild regenerates android/ from
 * the pristine template anyway.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TAG = '[with-crash-log]';
const PROVIDER_CLASS = 'CrashLogProvider';
// Marker used for idempotency: any manifest that already registers the
// provider contains exactly this string.
const PROVIDER_MARKER = 'android:name=".' + PROVIDER_CLASS + '"';

/**
 * Compose the full Kotlin source for CrashLogProvider + CrashLogWriter.
 * Pure function so it can be unit-tested. The Kotlin deliberately avoids
 * ${} string templates (JS-string interpolation hazard) and third-party
 * imports — framework APIs only.
 */
function composeProviderKotlin(pkg) {
  const lines = [
    'package ' + pkg,
    '',
    'import android.content.ContentProvider',
    'import android.content.ContentValues',
    'import android.content.Context',
    'import android.database.Cursor',
    'import android.net.Uri',
    'import android.os.Build',
    'import android.provider.MediaStore',
    'import java.io.File',
    'import java.io.PrintWriter',
    'import java.io.StringWriter',
    'import java.text.SimpleDateFormat',
    'import java.util.Date',
    'import java.util.Locale',
    '',
    '/**',
    ' * Installs a process-wide UncaughtExceptionHandler the moment the process',
    ' * starts (ContentProviders initialize before Application.onCreate), so any',
    ' * crash - native or a release-mode JavaScript error - is written to files:',
    ' *',
    ' *   1. app-private dir:  files/habit-tracker-crash-*.txt',
    ' *   2. user-visible dir: Downloads/habit-tracker-crash-*.txt (Android 10+)',
    ' *',
    ' * The Downloads copy is readable with any Files app - no adb, no developer',
    ' * options. Diagnostics must never crash the app or block crash delivery, so',
    ' * every step is guarded and the previous handler is always chained.',
    ' */',
    'class ' + PROVIDER_CLASS + ' : ContentProvider() {',
    '',
    '    override fun onCreate(): Boolean {',
    '        try {',
    '            val appContext = context?.applicationContext ?: return true',
    '            val previous = Thread.getDefaultUncaughtExceptionHandler()',
    '            Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->',
    '                try {',
    '                    CrashLogWriter.write(appContext, thread, throwable)',
    '                } catch (ignored: Throwable) {',
    '                    // never let logging itself interfere with crash handling',
    '                }',
    '                previous?.uncaughtException(thread, throwable)',
    '            }',
    '        } catch (ignored: Throwable) {',
    '            // diagnostics must never prevent startup',
    '        }',
    '        return true',
    '    }',
    '',
    '    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? = null',
    '',
    '    override fun getType(uri: Uri): String? = null',
    '',
    '    override fun insert(uri: Uri, values: ContentValues?): Uri? = null',
    '',
    '    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0',
    '',
    '    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0',
    '}',
    '',
    'object CrashLogWriter {',
    '    private const val PREFIX = "habit-tracker-crash"',
    '',
    '    fun write(context: Context, thread: Thread, throwable: Throwable) {',
    '        val report = buildReport(context, thread, throwable)',
    '        writeAppPrivate(context, report)',
    '        writeDownloads(context, report)',
    '    }',
    '',
    '    private fun buildReport(context: Context, thread: Thread, throwable: Throwable): String {',
    '        val sb = StringBuilder()',
    '        sb.append("Habit Tracker crash report")',
    "        sb.append('\\n')",
    '        sb.append("time: ")',
    '        sb.append(SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date()))',
    "        sb.append('\\n')",
    '        try {',
    '            val info = context.packageManager.getPackageInfo(context.packageName, 0)',
    '            sb.append("app version: ").append(info.versionName)',
    "            sb.append('\\n')",
    '        } catch (ignored: Throwable) {',
    '            sb.append("app version: unknown")',
    "            sb.append('\\n')",
    '        }',
    '        sb.append("device: ").append(Build.MANUFACTURER).append(\' \').append(Build.MODEL)',
    '        sb.append(", Android ").append(Build.VERSION.RELEASE)',
    '        sb.append(" (API ").append(Build.VERSION.SDK_INT).append(")")',
    "        sb.append('\\n')",
    '        sb.append("thread: ").append(thread.name)',
    "        sb.append('\\n')",
    "        sb.append('\\n')",
    '        sb.append("stack trace:")',
    "        sb.append('\\n')",
    '        val sw = StringWriter()',
    '        throwable.printStackTrace(PrintWriter(sw))',
    '        sb.append(sw.toString())',
    '        return sb.toString()',
    '    }',
    '',
    '    private fun writeAppPrivate(context: Context, report: String) {',
    '        try {',
    '            val dir = context.getExternalFilesDir(null) ?: File(context.filesDir, "crash")',
    '            if (!dir.exists()) dir.mkdirs()',
    '            File(dir, PREFIX + "-latest.txt").writeText(report)',
    '            File(dir, PREFIX + "-" + System.currentTimeMillis() + ".txt").writeText(report)',
    '        } catch (ignored: Throwable) {',
    '        }',
    '    }',
    '',
    '    private fun writeDownloads(context: Context, report: String) {',
    '        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return',
    '        try {',
    '            val resolver = context.contentResolver',
    '            val values = ContentValues()',
    '            values.put(MediaStore.Downloads.DISPLAY_NAME, PREFIX + "-" + System.currentTimeMillis() + ".txt")',
    '            values.put(MediaStore.Downloads.MIME_TYPE, "text/plain")',
    '            values.put(MediaStore.Downloads.IS_PENDING, 1)',
    '            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return',
    '            try {',
    '                resolver.openOutputStream(uri)?.use { stream ->',
    '                    stream.write(report.toByteArray())',
    '                }',
    '                values.clear()',
    '                values.put(MediaStore.Downloads.IS_PENDING, 0)',
    '                resolver.update(uri, values, null, null)',
    '            } catch (ignored: Throwable) {',
    '                try {',
    '                    resolver.delete(uri, null, null)',
    '                } catch (ignoredAgain: Throwable) {',
    '                }',
    '            }',
    '        } catch (ignored: Throwable) {',
    '        }',
    '    }',
    '}',
    ''
  ];
  return lines.join('\n');
}

/**
 * Compose the manifest child element for the provider. Pure function.
 * "${applicationId}" must stay LITERAL here — it is an AGP manifest
 * placeholder resolved at build time (this is a single-quoted JS string,
 * so no interpolation happens).
 */
function composeProviderManifestEntry() {
  return (
    '    <provider android:name=".' + PROVIDER_CLASS + '"' +
    ' android:authorities="${applicationId}.crashlog"' +
    ' android:exported="false"' +
    ' android:grantUriPermissions="false"/>'
  );
}

/**
 * Insert the provider into the manifest. Pure string function.
 * Returns { contents, added } so callers and tests can assert what happened.
 */
function patchAndroidManifest(contents) {
  if (contents.includes(PROVIDER_MARKER)) {
    return { contents, added: false };
  }
  if (!contents.includes('</application>')) {
    throw new Error(
      TAG + ' </application> not found in AndroidManifest.xml — the template layout changed upstream; crash logger NOT installed'
    );
  }
  return {
    contents: contents.replace(
      '</application>',
      composeProviderManifestEntry() + '\n  </application>'
    ),
    added: true
  };
}

/**
 * Read the Android namespace from the generated android/app/build.gradle.
 *
 * NOTE: at dangerous-mod time this file still carries Expo's TEMPLATE-DEFAULT
 * namespace ("com.<slug>") — the real android.package from app.json is
 * applied to app/build.gradle by a LATER default mod. Therefore this value
 * is only a FALLBACK; the authoritative source is config.android.package
 * (see withCrashLog). Verified empirically 2026-09-16: reading build.gradle
 * during the mod pipeline yielded "com.performancetracker" while the final
 * file (and config.android.package) is "com.getyourwish.performancetracker".
 */

function readNamespace(androidRoot) {
  const appGradle = path.join(androidRoot, 'app', 'build.gradle');
  const gradle = fs.readFileSync(appGradle, 'utf8');
  const match = gradle.match(/namespace\s+(?:'([^']+)'|"([^"]+)")/);
  if (!match) {
    return null;
  }
  return match[1] || match[2];
}

function withCrashLog(config) {
  return withDangerousMod(config, [
    'android',
    async config => {
      const androidRoot = path.join(config.modRequest.projectRoot, 'android');
      // config.android.package is the authoritative applicationId/namespace
      // (from app.json). build.gradle at dangerous-mod time still holds the
      // template default — see readNamespace doc block.
      const pkg =
        (config.android && config.android.package) || readNamespace(androidRoot);
      if (!pkg) {
        console.warn(
          TAG + ' WARNING: android.package missing from config and namespace not found in app/build.gradle — crash logger NOT installed'
        );
        return config;
      }
      // 1. write (or overwrite) the Kotlin provider source
      const kotlinDir = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'java',
        ...pkg.split('.')
      );
      fs.mkdirSync(kotlinDir, { recursive: true });
      fs.writeFileSync(
        path.join(kotlinDir, PROVIDER_CLASS + '.kt'),
        composeProviderKotlin(pkg)
      );

      // 2. register the provider in the manifest (idempotent)
      const manifestPath = path.join(
        androidRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml'
      );
      const original = fs.readFileSync(manifestPath, 'utf8');
      const { contents, added } = patchAndroidManifest(original);
      if (added) {
        fs.writeFileSync(manifestPath, contents);
        console.log(
          TAG + ' installed ' + PROVIDER_CLASS + ' — any crash will now be written to Downloads/habit-tracker-crash-*.txt on the device (no adb needed)'
        );
      } else {
        console.log(
          TAG + ' provider already registered in AndroidManifest.xml — skipping manifest edit'
        );
      }
      return config;
    }
  ]);
}

module.exports = withCrashLog;
module.exports.composeProviderKotlin = composeProviderKotlin;
module.exports.composeProviderManifestEntry = composeProviderManifestEntry;
module.exports.patchAndroidManifest = patchAndroidManifest;
module.exports.readNamespace = readNamespace;
module.exports.TAG = TAG;
module.exports.PROVIDER_CLASS = PROVIDER_CLASS;
