// Babel config for the Habit Tracker Android app.
// v1.0.7: the worklets plugin (and reanimated/worklets themselves) are GONE —
// react-native-draggable-flatlist was removed with them (unmaintained for
// React 19 + reanimated 4, prime suspect for the on-device "create a task →
// crash"); nothing in the app uses worklets anymore.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo']
  }
}
