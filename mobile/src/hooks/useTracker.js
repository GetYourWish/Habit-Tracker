// useTracker — React binding for the tracker store.
//  - useSyncExternalStore keeps renders in lockstep with store state
//  - persists the picked SAF folder + auto-sync preference in AsyncStorage
//  - polls for external changes every 15 s (desktop FILE_POLL_INTERVAL_MS
//    parity) and immediately on app foreground — Android has no inotify
//  - pull-to-refresh / manual refresh route through checkExternal(true)

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react'
import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createTrackerStore } from '../storage/store.js'
import { createSafAdapter } from '../storage/saf.js'

const KEY_FOLDER = 'pt.folderUri'
const KEY_AUTOSYNC = 'pt.autoSync'
export const FILE_POLL_INTERVAL_MS = 15000 // parity with desktop main.cjs

export function useTracker() {
  const [folderUri, setFolderUri] = useState(null)
  const [autoSync, setAutoSyncState] = useState(true)
  const [booted, setBooted] = useState(false)

  const storeRef = useRef(null)
  if (storeRef.current === null) {
    storeRef.current = createTrackerStore({ adapter: createSafAdapter(), dirUri: null })
  }
  const store = storeRef.current

  // bootstrap: restore persisted folder + auto-sync preference
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [savedFolder, savedAuto] = await Promise.all([
          AsyncStorage.getItem(KEY_FOLDER),
          AsyncStorage.getItem(KEY_AUTOSYNC)
        ])
        if (!alive) return
        if (typeof savedAuto === 'string') setAutoSyncState(savedAuto === '1')
        if (savedFolder) {
          setFolderUri(savedFolder)
          // Deliberately NOT awaited: a stalled SAF read on the restored
          // folder used to freeze `booted` (and with it the splash screen)
          // forever, even though the store's watchdog had already repainted
          // its state underneath. The store owns recovery from here — its
          // watchdog turns a stalled read into the actionable re-grant
          // screen — so boot must complete independently of that load.
          store.setFolder(savedFolder).catch(() => {})
        }
      } finally {
        if (alive) setBooted(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [store])

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  // External-change polling + foreground refresh (Android has no file events).
  // Intervals do not run reliably while Android has suspended the app, so a
  // Syncthing update that lands while it is backgrounded must be checked as
  // soon as the user returns—not up to 15 seconds later.
  useEffect(() => {
    if (!folderUri || !autoSync) return undefined
    const timer = setInterval(() => {
      store.checkExternal().catch(() => {})
    }, FILE_POLL_INTERVAL_MS)
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') store.checkExternal().catch(() => {})
    })
    return () => {
      clearInterval(timer)
      // Native AppState returns a subscription. The optional form also keeps
      // cleanup safe with older/test implementations that expose no handle.
      subscription?.remove?.()
    }
  }, [folderUri, autoSync, store])

  const pickFolder = useCallback(async () => {
    const adapter = (await import('../storage/saf.js')).createSafAdapter()
    const res = await adapter.requestFolder()
    if (!res.granted) return null
    await AsyncStorage.setItem(KEY_FOLDER, res.directoryUri)
    setFolderUri(res.directoryUri)
    await store.setFolder(res.directoryUri)
    return res.directoryUri
  }, [store])

  const setAutoSync = useCallback(async enabled => {
    setAutoSyncState(enabled)
    await AsyncStorage.setItem(KEY_AUTOSYNC, enabled ? '1' : '0')
  }, [])

  const refresh = useCallback(async () => {
    await store.checkExternal(true)
  }, [store])

  const forgetFolder = useCallback(async () => {
    await AsyncStorage.removeItem(KEY_FOLDER)
    setFolderUri(null)
    await store.setFolder(null)
  }, [store])

  return useMemo(
    () => ({
      store,
      state: snapshot,
      folderUri,
      autoSync,
      booted,
      pickFolder,
      setAutoSync,
      refresh,
      forgetFolder
    }),
    [store, snapshot, folderUri, autoSync, booted, pickFolder, setAutoSync, refresh, forgetFolder]
  )
}
