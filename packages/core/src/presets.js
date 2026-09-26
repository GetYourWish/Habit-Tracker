// presets.js — the pre-built starter board.
//
// DESIGN RULE: nothing here is "burned in" behaviour. These are plain rows of
// user data created once on first launch: every habit can be renamed, recolored,
// re-tagged with a different cadence, archived or deleted; every group is just a
// label chip the user owns. The app logic only ever reads frequencies + habits +
// completions — it never special-cases a preset by name.
//
// Each entry: { title, icon, frequencyKey, group, timesPerDay?, timesOfDay? }
//   frequencyKey must exist in systemFrequencies() (recurrence.js) at seed time.
//   group is a soft color-coded tag (stored as a normal category).
//   timesPerDay optionally overrides the cadence's default per-day count,
//   timesOfDay pins one time-of-day slot per occurrence (the "best time of
//   day" choices — e.g. brushing twice a day, morning and evening).

const STARTER_GROUPS = [
  { name: 'Body', color: '#34d399' },
  { name: 'Mind', color: '#a78bfa' },
  { name: 'Home', color: '#fbbf24' },
  { name: 'Work', color: '#60a5fa' }
]

const STARTER_HABITS = [
  // Body
  { title: 'Drink water', icon: '💧', frequencyKey: 'daily', group: 'Body', timesPerDay: 3, timesOfDay: ['morning', 'afternoon', 'evening'] },
  { title: 'Move for 30 min', icon: '🏃', frequencyKey: 'daily', group: 'Body' },
  { title: 'Brush teeth', icon: '🪥', frequencyKey: 'twice-daily', group: 'Body', timesOfDay: ['morning', 'evening'] },
  { title: 'Sleep before midnight', icon: '😴', frequencyKey: 'daily', group: 'Body', timesOfDay: ['night'] },
  { title: 'Stretch', icon: '🧘', frequencyKey: 'every-other-day', group: 'Body' },
  { title: 'Strength training', icon: '🏋️', frequencyKey: 'twice-weekly', group: 'Body' },
  { title: 'Long walk / hike', icon: '🥾', frequencyKey: 'weekly', group: 'Body' },
  // Mind
  { title: 'Read 20 minutes', icon: '📖', frequencyKey: 'daily', group: 'Mind', timesOfDay: ['night'] },
  { title: 'Journal', icon: '✍️', frequencyKey: 'weekdays', group: 'Mind', timesOfDay: ['evening'] },
  { title: 'Meditate', icon: '🌬️', frequencyKey: 'daily', group: 'Mind', timesOfDay: ['morning'] },
  { title: 'Learn a language', icon: '🈺', frequencyKey: 'daily', group: 'Mind' },
  { title: 'Practice an instrument', icon: '🎸', frequencyKey: 'twice-weekly', group: 'Mind' },
  { title: 'Digital detox evening', icon: '📵', frequencyKey: 'weekly', group: 'Mind', timesOfDay: ['evening'] },
  // Home
  { title: 'Tidy 10 minutes', icon: '🧹', frequencyKey: 'daily', group: 'Home', timesOfDay: ['evening'] },
  { title: 'Do the dishes', icon: '🍽️', frequencyKey: 'daily', group: 'Home', timesOfDay: ['evening'] },
  { title: 'Laundry', icon: '🧺', frequencyKey: 'weekly', group: 'Home' },
  { title: 'Water the plants', icon: '🪴', frequencyKey: 'every-other-day', group: 'Home' },
  { title: 'Take out trash', icon: '🗑️', frequencyKey: 'weekly', group: 'Home' },
  { title: 'Deep clean one room', icon: '🧽', frequencyKey: 'monthly', group: 'Home' },
  // Work
  { title: 'Plan tomorrow', icon: '🗒️', frequencyKey: 'weekdays', group: 'Work', timesOfDay: ['evening'] },
  { title: 'Inbox zero', icon: '📥', frequencyKey: 'weekdays', group: 'Work' },
  { title: 'Deep work block', icon: '🎯', frequencyKey: 'weekdays', group: 'Work', timesOfDay: ['morning'] },
  { title: 'Weekly review', icon: '🔍', frequencyKey: 'weekly', group: 'Work' },
  { title: 'Back up my files', icon: '💾', frequencyKey: 'monthly', group: 'Work' }
]

module.exports = { STARTER_GROUPS, STARTER_HABITS }
