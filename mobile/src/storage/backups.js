// Rolling backup window — desktop parity with electron/main.cjs createBackup().
//
// Desktop keeps `.backups/habit-<timestamp>.json` NEXT TO the data file
// (last 20). On Android the data file lives in a Syncthing-fed SAF folder:
// a `.backups` folder there would (a) need directory creation the SAF API
// does not expose and (b) sync backup churn to every peer. So the Android
// app keeps the SAME naming scheme and rotation window in its app-private
// documents directory instead — restore copies stay on the device that
// created them, and the synced folder stays clean.
//
// The pure helpers below are unit-tested in Node (__tests__/store.test.js).

export const BACKUP_PREFIX = 'habit-'
export const BACKUP_EXT = '.json'
export const BACKUP_KEEP = 20

// Damaged-file evidence copies. When habit.json fails to parse, the exact
// damaged bytes are preserved byte-for-byte in the app-private .corrupt/
// folder BEFORE any recovery option is offered — a botched restore can
// always be undone by hand. Rolling window, newest last, never synced.
export const CORRUPT_PREFIX = 'corrupt-'
export const CORRUPT_KEEP = 10

// desktop: new Date().toISOString().replace(/[:.]/g, '-')
export function backupFileName(isoTimestamp) {
  return `${BACKUP_PREFIX}${String(isoTimestamp).replace(/[:.]/g, '-')}${BACKUP_EXT}`
}

// desktop: new Date().toISOString().replace(/[:.]/g, '-')
export function corruptFileName(isoTimestamp) {
  return `${CORRUPT_PREFIX}${String(isoTimestamp).replace(/[:.]/g, '-')}${BACKUP_EXT}`
}

// Desktop sorts filenames lexicographically; ISO timestamps with '-' where
// ':' and '.' were sort identically lexicographically. Newest last.
export function isBackupName(name) {
  return name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_EXT)
}

export function isCorruptName(name) {
  return name.startsWith(CORRUPT_PREFIX) && name.endsWith(BACKUP_EXT)
}

// Generic rolling-window rotation: of the names matching `match` (sorted
// lexicographically = chronologically for our timestamp scheme), return the
// ones to delete so that only the newest `keep` survive.
export function selectOldNamed(names, keep, match) {
  const list = names.filter(match).sort()
  return list.length > keep ? list.slice(0, list.length - keep) : []
}

export function selectOldBackups(names, keep = BACKUP_KEEP) {
  return selectOldNamed(names, keep, isBackupName)
}

export function selectOldCorrupt(names, keep = CORRUPT_KEEP) {
  return selectOldNamed(names, keep, isCorruptName)
}
