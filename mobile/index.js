// App entry.
// react-native-get-random-values MUST be imported before anything that can
// load uuid (i.e. @habit-tracker/core): Hermes has no
// crypto.getRandomValues, and core's generateId() is uuid-v4 based.
import 'react-native-get-random-values'
import { installReleaseCrashReporter } from './src/diagnostics'
import { registerRootComponent } from 'expo'

import App from './App'

// Release builds: record the last fatal JS error in-app (the user has no
// logcat) so the app can show it on the next launch. No-op in dev.
installReleaseCrashReporter()

// registerRootComponent ensures the Expo environment (Go / prebuilt) mounts App.
registerRootComponent(App)
